
import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_URL = "http://localhost:8000"

def test_snapshot():
    payload = {
        "user_id": "SchemaTest",
        "total_current": 100,
        "total_invested": 90,
        "kr_current": 50,
        "kr_invested": 45,
        "us_current": 50,
        "us_invested": 45
    }
    
    try:
        res = requests.post(f"{API_URL}/history/snapshot", json=payload)
        print(f"Status: {res.status_code}")
        print(f"Response: {res.text}")
    except Exception as e:
        print(e)

if __name__ == "__main__":
    test_snapshot()
