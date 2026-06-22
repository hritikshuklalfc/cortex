# Cortex: Industrial Intelligence Platform

Cortex (also known internally as Vardex) is an advanced, AI-powered knowledge and industrial intelligence platform. It enables users to upload, process, and interact with complex industrial documents, safety manuals, maintenance logs, and standard operating procedures (SOPs) through a conversational interface powered by Google's Gemini 2.5 Flash model and RAG (Retrieval-Augmented Generation).

## Features

- **Document Ingestion**: Upload large documents (up to 100MB) which are processed and chunked in the background.
- **RAG Powered Chat**: Chat directly with your data. The system retrieves relevant context from your uploaded files and synthesizes answers using the Gemini 2.5 Flash model.
- **Dynamic Chart Generation**: Automatically generate metrics and visualizations (using Recharts) directly from chat when asking about statistics, trends, or numbers in your data.
- **File Scoping**: Restrict your queries to specific uploaded documents for highly targeted intelligence.
- **Modern UI**: A responsive, animated, and dynamic frontend built with Next.js 16, React 19, Framer Motion, and TailwindCSS v4.

## Tech Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: SQLite (via SQLAlchemy) for metadata tracking
- **Vector Storage**: ChromaDB for embedding and semantic search retrieval
- **LLM Integration**: Google GenAI SDK (`gemini-2.5-flash`)
- **Key Dependencies**: `aiofiles` for async chunked uploads, `pydantic` for request validation.

### Frontend
- **Framework**: Next.js 16.2
- **UI Library**: React 19
- **Styling**: Tailwind CSS v4, `clsx`, `tailwind-merge`
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **Data Visualization**: Recharts

## Setup Instructions

### Prerequisites
- Python 3.10+
- Node.js 20+
- A Google Gemini API Key

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Set up your environment variables by creating a `.env` file in the `backend` directory:
   ```env
   GEMINI_API_KEY=your_google_gemini_api_key
   ```
5. Run the FastAPI development server:
   ```bash
   uvicorn main:app --reload
   ```
   *The API will be available at `http://localhost:8000`*

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   *The application will be available at `http://localhost:3000`*

## Sample Data
The repository includes a `sample_data` directory containing dummy industrial data (like `turbine_maintenance_logs_2026.csv` and `boiler_valve_SOP_manual.md`) that you can upload to the platform to test its RAG and data visualization capabilities.

## License
MIT
