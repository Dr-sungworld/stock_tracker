import FinanceDataReader as fdr
import datetime
import pandas as pd

def test_us_price(code):
    print(f"\nTesting {code}...")
    try:
        # 1. Market Detection Simulation
        # (Skip full load, just assume we know it's US for this test)
        
        # 2. Fetch Price
        today = datetime.datetime.now()
        start = today - datetime.timedelta(days=10) # Increased to 10 to be safe
        print(f"Fetching from {start.date()} to {today.date()}")
        
        df = fdr.DataReader(code, start)
        
        if df.empty:
            print(f"FAILED: Empty DataFrame for {code}")
            return

        print("Data Information:")
        print(df.tail(3))
        
        last_row = df.iloc[-1]
        price = float(last_row['Close'])
        print(f"SUCCESS: {code} Price: {price}")
        
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    test_us_price("AAPL")
    test_us_price("NVDA")
    test_us_price("TSLA")
