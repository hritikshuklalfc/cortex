from sqlalchemy import create_engine, Column, Integer, String, DateTime, func
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./knowledge.db")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    doc_type = Column(String)  # e.g., 'pdf', 'csv'
    upload_date = Column(DateTime(timezone=True), server_default=func.now())
    tags = Column(String) # Comma separated tags
    status = Column(String, default="pending")  # pending, processing, completed, failed
    file_size = Column(Integer, default=0)  # file size in bytes
    chunk_count = Column(Integer, default=0)  # number of vector chunks created

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
