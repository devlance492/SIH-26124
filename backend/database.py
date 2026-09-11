import os
import urllib.parse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

IS_TESTING = os.getenv("TESTING") == "1"
IS_VERCEL = os.getenv("VERCEL") == "1" or os.getenv("VERCEL_ENV") is not None

# Custom or Cloud DATABASE_URL
env_db_url = os.getenv("DATABASE_URL")

if IS_TESTING:
    DATABASE_URL = "sqlite:///:memory:"
    engine = create_engine(
        DATABASE_URL, 
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
elif env_db_url:
    DATABASE_URL = env_db_url
    if DATABASE_URL.startswith("sqlite"):
        engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
    else:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
elif IS_VERCEL and not os.getenv("DB_HOST"):
    # In Vercel serverless without explicit DB_HOST, use SQLite in /tmp
    DATABASE_URL = "sqlite:////tmp/sih26124.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    DB_USER = os.getenv("DB_USER", "root")
    raw_password = os.getenv("DB_PASSWORD", "root")
    DB_PASSWORD = urllib.parse.quote_plus(raw_password)
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_NAME = os.getenv("DB_NAME", "sih26124")
    
    try:
        DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    except Exception:
        DATABASE_URL = "sqlite:////tmp/sih26124.db"
        engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Create a configured "Session" class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create a declarative base class
Base = declarative_base()

# Dependency for FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
