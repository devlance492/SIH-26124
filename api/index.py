import os
import sys

# Add backend directory to sys.path so app and its dependencies can be imported
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app import app
