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

# ... (Global df_stocks and lifespan)

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
        # Optimization: Load only necessary or cache.
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

class SnapshotRequest(BaseModel):
    user_id: str
    total_current: float
    total_invested: float
    kr_current: Optional[float] = 0.0
    kr_invested: Optional[float] = 0.0
    us_current: Optional[float] = 0.0
    us_invested: Optional[float] = 0.0


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
                "market": row.get('market', 'KR'), # Safe get
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
        # Strategy: Delete all for user, then re-insert. 
        # WARNING: This is risky if insert fails.
        # Ideally we check schema or use upsert. 
        # For now, we implement fallback on insert failure to restore data (or at least try to save without new cols).
        
        # We can't easily "restore" the deleted data if insert fails unless we kept it in memory (we verify req.holdings has it).
        
        # 1. Delete
        supabase.table('holdings').delete().eq('user_id', user_id).execute()
        
        if not holdings:
            return

        # 2. Prepare for DB (With Market)
        db_rows_full = []
        db_rows_fallback = []
        
        for h in holdings:
            base = {
                "user_id": user_id,
                "name": h.get("name"),
                "code": h.get("code"),
                "buy_price": h.get("buyPrice", 0),
                "quantity": h.get("quantity", 1)
            }
            # Full version
            full = base.copy()
            full["market"] = h.get("market", "KR")
            db_rows_full.append(full)
            
            # Fallback version
            db_rows_fallback.append(base)
            
        try:
            supabase.table('holdings').insert(db_rows_full).execute()
        except Exception as e_full:
            print(f"Insert with market failed (schema mismatch?): {e_full}. Retrying without market column...")
            try:
                supabase.table('holdings').insert(db_rows_fallback).execute()
            except Exception as e_fallback:
                 print(f"CRITICAL: Fallback insert also failed: {e_fallback}. Data for {user_id} might be lost from DB but exists in payload.")
                 # In a real app we would raise 500 here so client knows save failed.
                 raise e_fallback
        
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

@app.get("/exchange-rate")
def get_exchange_rate():
    try:
        # Use FinanceDataReader for USD/KRW
        # Symbol is 'USD/KRW'
        today = datetime.datetime.now()
        start = today - datetime.timedelta(days=7) 
        df = fdr.DataReader('USD/KRW', start)
        
        if df.empty:
            return {"rate": 1400.0, "error": "No data"}
            
        rate = float(df.iloc[-1]['Close'])
        return {"rate": rate}
    except Exception as e:
        print(f"Exchange rate error: {e}")
        return {"rate": 1400.0, "error": str(e)}

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
        
        # print(f"DEBUG: Code={code}, Market={market}") 

        if market == 'US':
            # US Stock Logic via FDR
            try:
                # Get last 14 days (safer for long weekends/holidays)
                today = datetime.datetime.now()
                start = today - datetime.timedelta(days=14)
                
                df = fdr.DataReader(code, start)
                if df.empty:
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
                return {"code": code, "price": 0, "rate": 0, "change": "0", "error": str(UsEx)} 

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
        return {"code": code, "price": 0, "rate": 0, "change": "0", "error": str(e)}

@app.post("/history/snapshot")
def save_snapshot(req: SnapshotRequest):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        daily_return = req.total_current - req.total_invested
        daily_return_rate = 0
        if req.total_invested > 0:
            daily_return_rate = (daily_return / req.total_invested) * 100
        
        # Check recent snapshot (1 hr check)
        # Note: logic simplified for robustness
        should_update = False
        update_id = None
        
        last_record_resp = supabase.table("portfolio_history")\
            .select("id, created_at")\
            .eq("user_id", req.user_id)\
            .order("created_at", desc=True)\
            .limit(1)\
            .execute()
            
        if last_record_resp.data:
            last = last_record_resp.data[0]
            try:
                last_time_str = last['created_at'].replace('Z', '+00:00')
                last_time = datetime.datetime.fromisoformat(last_time_str)
                now = datetime.datetime.now(datetime.timezone.utc)
                diff = (now - last_time).total_seconds()
                if diff < 3600:
                    should_update = True
                    update_id = last['id']
            except:
                pass

        data = {
            "user_id": req.user_id,
            "total_current_value": req.total_current,
            "total_invested_value": req.total_invested,
            "daily_return": daily_return,
            "daily_return_rate": daily_return_rate,
            "kr_current_value": req.kr_current,
            "kr_invested_value": req.kr_invested,
            "us_current_value": req.us_current,
            "us_invested_value": req.us_invested,
            "date": datetime.date.today().isoformat()
        }
        
        if should_update and update_id:
            supabase.table("portfolio_history").update(data).eq("id", update_id).execute()
        else:
            supabase.table("portfolio_history").insert(data).execute()
            
        return {"status": "success", "action": "update" if should_update else "insert"}

    except Exception as e:
        print(f"Snapshot error: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/history/{user_id}")
def get_history(user_id: str, range: str = '1M'):
    if not supabase:
        return []

    try:
        # Determine date filter
        today = datetime.date.today()
        start_date = today
        
        if range == '1W':
            start_date = today - datetime.timedelta(days=7)
        elif range == '1M':
            start_date = today - datetime.timedelta(days=30)
        elif range == '3M':
            start_date = today - datetime.timedelta(days=90)
        elif range == '1Y':
            start_date = today - datetime.timedelta(days=365)
        else:
            start_date = today - datetime.timedelta(days=365*10) # 'ALL'

        response = supabase.table("portfolio_history")\
            .select("created_at, date, total_current_value, total_invested_value, daily_return, daily_return_rate, kr_current_value, us_current_value, kr_invested_value, us_invested_value")\
            .eq("user_id", user_id)\
            .gte("date", start_date.isoformat())\
            .order("created_at", desc=False)\
            .execute()
            
        # Calculate returns for each row
        results = []
        for row in response.data:
            item = row.copy()
            # Calculate Split Returns if data exists
            if item.get('kr_current_value') is not None and item.get('kr_invested_value') is not None:
                item['kr_return'] = item['kr_current_value'] - item['kr_invested_value']
                item['kr_rate'] = (item['kr_return'] / item['kr_invested_value'] * 100) if item['kr_invested_value'] > 0 else 0
            
            if item.get('us_current_value') is not None and item.get('us_invested_value') is not None:
                item['us_return'] = item['us_current_value'] - item['us_invested_value']
                item['us_rate'] = (item['us_return'] / item['us_invested_value'] * 100) if item['us_invested_value'] > 0 else 0
                
            results.append(item)
            
        return results

    except Exception as e:
        print(f"History fetch error: {e}")
        return []

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
