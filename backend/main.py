from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import aiofiles
from dotenv import load_dotenv

load_dotenv()

from database import SessionLocal, engine, Base, Document, get_db
from ingest import ingest_document, vector_store, delete_vectors_by_filename

# Initialize DB tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Cortex | Industrial Intelligence Platform API")

# Configure CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request Models ───

class QueryRequest(BaseModel):
    query: str
    file_ids: Optional[List[int]] = None  # Optional: scope query to specific files


# ─── Constants ───

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
UPLOAD_CHUNK_SIZE = 1024 * 1024     # 1MB chunks for writing


# ─── Routes ───

@app.get("/")
def read_root():
    return {"message": "Welcome to the Cortex Intelligence Platform API"}


@app.get("/documents")
def get_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.upload_date.desc()).all()
    return {"documents": [
        {
            "id": d.id,
            "filename": d.filename,
            "doc_type": d.doc_type,
            "upload_date": str(d.upload_date),
            "status": d.status or "completed",
            "file_size": d.file_size or 0,
            "chunk_count": d.chunk_count or 0,
        }
        for d in docs
    ]}


@app.get("/documents/{doc_id}")
def get_document(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "id": doc.id,
        "filename": doc.filename,
        "doc_type": doc.doc_type,
        "upload_date": str(doc.upload_date),
        "status": doc.status or "completed",
        "file_size": doc.file_size or 0,
        "chunk_count": doc.chunk_count or 0,
    }


@app.get("/documents/{doc_id}/status")
def get_document_status(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": doc.id, "filename": doc.filename, "status": doc.status or "completed"}


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete vectors from ChromaDB
    deleted_count = delete_vectors_by_filename(doc.filename)
    
    # Delete from database
    db.delete(doc)
    db.commit()
    
    return {
        "message": f"Document '{doc.filename}' deleted successfully.",
        "vectors_removed": deleted_count,
    }


def process_upload(file_path: str, filename: str, doc_id: int):
    """Background task: ingest document and update status."""
    db = SessionLocal()
    try:
        # Update status to processing
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if doc:
            doc.status = "processing"
            db.commit()
        
        # Ingest the document
        num_chunks = ingest_document(file_path, filename)
        
        # Update status to completed
        if doc:
            doc.status = "completed"
            doc.chunk_count = num_chunks
            db.commit()
        
        print(f"Successfully ingested {filename} into {num_chunks} chunks.")
    except Exception as e:
        # Update status to failed
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if doc:
            doc.status = "failed"
            db.commit()
        print(f"Error ingesting {filename}: {str(e)}")
    finally:
        db.close()
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/upload")
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    os.makedirs("temp", exist_ok=True)
    uploaded = []
    
    for file in files:
        temp_file_path = f"temp/{file.filename}"
        
        # Chunked write for large files — read/write in 1MB chunks
        file_size = 0
        async with aiofiles.open(temp_file_path, "wb") as buffer:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    # Clean up and reject
                    await buffer.close()
                    if os.path.exists(temp_file_path):
                        os.remove(temp_file_path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File '{file.filename}' exceeds the {MAX_FILE_SIZE // (1024*1024)}MB size limit.",
                    )
                await buffer.write(chunk)
        
        # Save metadata to DB
        ext = file.filename.split(".")[-1].lower()
        new_doc = Document(
            filename=file.filename,
            doc_type=ext,
            status="pending",
            file_size=file_size,
        )
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)
        
        # Add ingest task to background
        background_tasks.add_task(process_upload, temp_file_path, file.filename, new_doc.id)
        uploaded.append({
            "id": new_doc.id,
            "filename": file.filename,
            "file_size": file_size,
            "status": "pending",
        })
    
    return {
        "message": f"{len(uploaded)} document(s) uploaded successfully and are being processed.",
        "files": uploaded,
    }


@app.post("/chat")
async def chat(request: QueryRequest, db: Session = Depends(get_db)):
    import google.genai as genai
    
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured.")
    
    # ── Build retriever with optional file-scope filtering ──
    search_kwargs = {"k": 6}
    
    if request.file_ids:
        # Resolve file_ids to filenames
        docs_in_scope = db.query(Document).filter(Document.id.in_(request.file_ids)).all()
        filenames = [d.filename for d in docs_in_scope]
        
        if filenames:
            if len(filenames) == 1:
                search_kwargs["filter"] = {"source_filename": filenames[0]}
            else:
                search_kwargs["filter"] = {"source_filename": {"$in": filenames}}
    
    retriever = vector_store.as_retriever(search_kwargs=search_kwargs)
    docs = retriever.invoke(request.query)
    
    # Build context from retrieved documents
    context_parts = []
    citations = []
    for doc in docs:
        context_parts.append(doc.page_content)
        source = doc.metadata.get("source_filename", "Unknown Source")
        if source not in citations:
            citations.append(source)
    
    context = "\n\n---\n\n".join(context_parts)
    
    query_lower = request.query.lower()
    show_chart = any(word in query_lower for word in ["graph", "chart", "metrics", "trends", "plot", "statistics", "numbers"])
    
    # Build the prompt
    system_prompt = (
        "You are an expert AI assistant for an Industrial Knowledge Platform called Vardex. "
        "Use the following retrieved context to answer the user's question accurately and concisely. "
        "If the context doesn't contain relevant information, say so honestly. "
        "Always reference specific details from the documents when possible.\n\n"
    )

    if request.file_ids:
        system_prompt += (
            "NOTE: The user has scoped this query to specific documents. "
            "Focus your answer ONLY on information from those documents.\n\n"
        )

    if show_chart:
        system_prompt += (
            "IMPORTANT: The user has requested a chart, graph, or metrics. "
            "You MUST output your response as a valid JSON object containing exactly these two keys: "
            "'text' (string) containing your detailed answer, and 'chartData' (array) containing the data points. "
            "Each data point in 'chartData' MUST be an object with 'name' (string) and 'value' (number). "
            'Example: {"text": "Here are the metrics...", "chartData": [{"name": "Jan", "value": 10}, {"name": "Feb", "value": 15}]}\n\n'
        )
        
    system_prompt += f"CONTEXT:\n{context}"
    
    # Call Gemini directly using google-genai SDK
    client = genai.Client(api_key=api_key)
    
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=request.query,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.3,
                response_mime_type="application/json" if show_chart else "text/plain"
            )
        )
        
        response_data = {}
        if show_chart:
            import json
            try:
                # Parse the JSON response returned by the LLM
                llm_json = json.loads(response.text)
                response_data = {
                    "response": llm_json.get("text", "Here is the chart data."),
                    "chartData": llm_json.get("chartData", []),
                    "showChart": True,
                    "citations": citations
                }
            except Exception as e:
                # Fallback if JSON parsing fails
                response_data = {
                    "response": response.text,
                    "citations": citations,
                    "showChart": False
                }
        else:
            response_data = {
                "response": response.text,
                "citations": citations,
                "showChart": False
            }

        return response_data
    except Exception as e:
        error_msg = str(e)
        if "Quota" in error_msg or "Resource has been exhausted" in error_msg:
            raise HTTPException(status_code=429, detail="API Rate Limit Exceeded. Please try again later.")
        else:
            raise HTTPException(status_code=500, detail=f"Generation error: {error_msg}")
