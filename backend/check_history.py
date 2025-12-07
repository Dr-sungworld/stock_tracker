import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase = create_client(url, key)

print("--- Portfolio History Content ---")
res = supabase.table("portfolio_history").select("*").execute()
print(res.data)
