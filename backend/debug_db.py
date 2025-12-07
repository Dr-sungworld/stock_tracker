import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Error: Missing credentials")
    exit(1)

supabase = create_client(url, key)

user_id = "debug_user"

# Try to insert a dummy record with quantity
data = {
    "user_id": user_id,
    "name": "DebugStock",
    "code": "000000",
    "market": "KR",
    "buy_price": 100,
    "quantity": 10
}

print(f"Attempting to insert: {data}")

try:
    response = supabase.table("holdings").insert(data).execute()
    print("Insert SUCCESS!")
    print(response)
    
    # Cleanup
    supabase.table("holdings").delete().eq("user_id", user_id).execute()
    print("Cleanup succesful.")

except Exception as e:
    print("\n!!! INSERT FAILED !!!")
    print(e)
