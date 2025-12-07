from dotenv import load_dotenv
import os
import datetime
from supabase import create_client, Client
import contextlib
import pandas as pd
import FinanceDataReader as fdr
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Load env variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Supabase Client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("Supabase client initialized.")
    except Exception as e:
        print(f"Failed to initialize Supabase: {e}")

# ... (Global df_stocks and lifespan remain similar, but we might verify connection in lifespan)

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Load stock list
    print("Loading stock list from FinanceDataReader...")
    global df_stocks
    try:
        # Load KRX
        df_krx = fdr.StockListing('KRX')
        df_krx['market'] = 'KR'
        
        # Load US Stocks (Major Exchanges)
        print("Loading US stocks (this may take a moment)...")
        # Optimization: Load only necessary or cache. For now, load fully.
        df_nasdaq = fdr.StockListing('NASDAQ')
        df_nyse = fdr.StockListing('NYSE')
        df_amex = fdr.StockListing('AMEX')
        
        df_us = pd.concat([df_nasdaq, df_nyse, df_amex])
        df_us['market'] = 'US'
        df_us = df_us.rename(columns={'Symbol': 'Code'})
        
        cols = ['Code', 'Name', 'market']
        df_stocks = pd.concat([df_krx[cols], df_us[cols]])
        print(f"Loaded {len(df_stocks)} stocks (KR: {len(df_krx)}, US: {len(df_us)}).")
        
    except Exception as e:
        print(f"Failed to load stock list: {e}")
        df_stocks = pd.DataFrame(columns=['Code', 'Name', 'market'])
    yield

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for simplicity and to ensure Vercel works
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
class StockItem(BaseModel):
    name: str
    code: str
    market: str

class SearchResponse(BaseModel):
    items: List[StockItem]

class HoldingsRequest(BaseModel):
    holdings: List[dict]


def load_holdings(user_id: str):
    if not supabase:
        print("Supabase not configured. Returning empty.")
        return []
    
    try:
        response = supabase.table('holdings').select("*").eq('user_id', user_id).execute()
        # Map DB columns back to frontend expected structure
        # DB: buy_price -> Frontend: buyPrice
        data = []
        for row in response.data:
            data.append({
                "name": row['name'],
                "code": row['code'],
                "market": row['market'],
                "buyPrice": float(row['buy_price']),
                "quantity": int(row.get('quantity', 1) or 1) # Default to 1
            })
        return data
    except Exception as e:
        print(f"Error loading holdings from Supabase: {e}")
        return []

def save_holdings(user_id: str, holdings):
    if not supabase:
        print("Supabase not configured. Cannot save.")
        return

    try:
        # Strategy: Delete all for user, then re-insert. (Transaction ideal but simple batch works for personal app)
        supabase.table('holdings').delete().eq('user_id', user_id).execute()
        
        if not holdings:
            return

        # Prepare for DB
        db_rows = []
        for h in holdings:
            db_rows.append({
                "user_id": user_id,
                "name": h.get("name"),
                "code": h.get("code"),
                "market": h.get("market", "KR"),
                "buy_price": h.get("buyPrice", 0),
                "quantity": h.get("quantity", 1)
            })
            
        supabase.table('holdings').insert(db_rows).execute()
        
    except Exception as e:
        print(f"Error saving holdings to Supabase: {e}")

@app.get("/holdings/{user_id}")
def get_holdings(user_id: str):
    return load_holdings(user_id)

@app.post("/holdings/{user_id}")
def update_holdings(user_id: str, req: HoldingsRequest):
    save_holdings(user_id, req.holdings)
    return {"status": "success", "count": len(req.holdings)}

@app.get("/search")
def search_stock(q: str):
    if not q:
        return {"items": []}

    try:
        if df_stocks.empty:
            return {"items": []}

        # Simple containment search
        # Limit to top 20 matches
        # Check Name or Code
        mask = df_stocks['Name'].str.contains(q, case=False, na=False) | \
               df_stocks['Code'].str.contains(q, case=False, na=False)
        
        results = df_stocks[mask].head(20)
        
        items = []
        for _, row in results.iterrows():
            items.append({
                "name": row['Name'],
                "code": row['Code'],
                "market": row['market']
            })
        
        return {"items": items}

    except Exception as e:
        print(f"Error searching: {e}")
        return {"items": []}

@app.get("/price")
def get_price(code: str):
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")

    try:
        # Determine market
        market = 'KR'
        if not df_stocks.empty:
            found = df_stocks[df_stocks['Code'] == code]
            if not found.empty:
                market = found.iloc[0]['market']
        
        print(f"DEBUG: Code={code}, Market={market}") # Debug Print

        if market == 'US':
            # US Stock Logic via FDR
            try:
                # Get last 14 days (safer for long weekends/holidays)
                today = datetime.datetime.now()
                start = today - datetime.timedelta(days=14)
                
                df = fdr.DataReader(code, start)
                if df.empty:
                    # Try Yahoo finance ticker format if needed, but FDR acts smart usually
                    raise ValueError(f"Empty data returned for {code}")
                
                last_row = df.iloc[-1]
                # If only 1 row, prev is same (0 change)
                prev_row = df.iloc[-2] if len(df) > 1 else last_row
                
                price = float(last_row['Close'])
                prev_close = float(prev_row['Close'])
                change = price - prev_close
                rate = 0.0
                if prev_close != 0:
                    rate = (change / prev_close) * 100
                
                return {
                    "code": code,
                    "price": price,
                    "rate": rate,
                    "change": f"{change:.2f}"
                }
            except Exception as UsEx:
                print(f"US Stock fetch error for {code}: {UsEx}")
                return {"code": code, "price": 0, "rate": 0, "change": "0", "error": str(UsEx)} # Return 0 with error details instead of crashing

        else:
            # KR Stock Logic via Naver
            url = f"https://finance.naver.com/item/main.naver?code={code}"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            }
            
            response = requests.get(url, headers=headers)
            response.encoding = 'EUC-KR'
            
            soup = BeautifulSoup(response.text, 'html.parser')
            
            no_today = soup.select_one('.no_today')
            if not no_today:
                 # Ensure we don't crash, just return 0
                 return {"code": code, "price": 0, "rate": 0, "change": "0", "error": "KR Data parse fail"}
                 
            price_span = no_today.select_one('.blind')
            price_text = price_span.get_text(strip=True).replace(',', '')
            price = int(price_text)
            
            no_exday = soup.select_one('.no_exday')
            blinds = no_exday.select('.blind')
            
            change_text = "0"
            rate_text = "0"
            if len(blinds) >= 2:
                change_text = blinds[0].get_text(strip=True)
                rate_text = blinds[1].get_text(strip=True)
            
            is_up = bool(no_exday.select('.ico.up') or no_exday.select('.ico.upper'))
            is_down = bool(no_exday.select('.ico.down') or no_exday.select('.ico.low'))
            
            rate = float(rate_text)
            if is_down:
                rate = -abs(rate)
            if is_up:
                rate = abs(rate)
                
            return {
                "code": code,
                "price": price,
                "rate": rate,
                "change": change_text
            }

    except Exception as e:
        print(f"Error fetching price for {code}: {e}")
        # Return graceful error JSON
        return {"code": code, "price": 0, "rate": 0, "change": "0", "error": str(e)}

# --- History / Snapshot Logic ---

class SnapshotRequest(BaseModel):
    user_id: str
    total_current: float
    total_invested: float

@app.post("/history/snapshot")
def save_snapshot(req: SnapshotRequest):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        daily_return = req.total_current - req.total_invested
        daily_return_rate = 0
        if req.total_invested > 0:
            daily_return_rate = (daily_return / req.total_invested) * 100
        
        # Upsert for today (assuming unique constraint on user_id, date)
        # Supabase upsert requires the dictionary to match columns
        data = {
            "user_id": req.user_id,
            "total_current_value": req.total_current,
            "total_invested_value": req.total_invested,
            "daily_return": daily_return,
            "daily_return_rate": daily_return_rate,
            # date defaults to CURRENT_DATE in DB, but for upsert conflict resolution we might need it explicit?
            # Actually, if we don't provide date, it defaults to today. 
            # If we rely on default, we might duplicate if we run it multiple times?
            # No, because UNIQUE(user_id, date).
            # But to trigger upsert (on conflict update), we usually need to specify the conflict target.
            # Let's try explicit date python side to be sure.
             "date": datetime.date.today().isoformat()
        }
        
        response = supabase.table("portfolio_history").upsert(data, on_conflict="user_id, date").execute()
        return {"status": "success", "data": data}

    except Exception as e:
        print(f"Snapshot error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{user_id}")
def get_history(user_id: str, range: str = "ALL"):
    if not supabase:
        return []
    
    try:
        query = supabase.table("portfolio_history").select("*").eq("user_id", user_id).order("date")
        
        # Simple date filtering logic
        today = datetime.date.today()
        start_date = None
        
        if range == "1W":
            start_date = today - datetime.timedelta(weeks=1)
        elif range == "1M":
            start_date = today - datetime.timedelta(days=30)
        elif range == "3M":
            start_date = today - datetime.timedelta(days=90)
        elif range == "1Y":
            start_date = today - datetime.timedelta(days=365)
            
        if start_date:
            query = query.gte("date", start_date.isoformat())
            
        response = query.execute()
        return response.data
        
    except Exception as e:
        print(f"History fetch error: {e}")
        return []

@app.get("/debug/price/{code}")
def debug_price(code: str):
    try:
        market = 'UNKNOWN'
        found_info = "Not found in df_stocks"
        if not df_stocks.empty:
            found = df_stocks[df_stocks['Code'] == code]
            if not found.empty:
                market = found.iloc[0]['market']
                found_info = found.iloc[0].to_dict()
        
        return {
            "code": code,
            "detected_market": market,
            "df_stocks_size": len(df_stocks),
            "found_info": str(found_info)
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
