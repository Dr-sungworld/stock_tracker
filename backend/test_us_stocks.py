import FinanceDataReader as fdr
import pandas as pd
import time

def test_us_loading():
    print("Loading US Stock Lists...")
    start = time.time()
    
    # Major US exchanges
    nasdaq = fdr.StockListing('NASDAQ')
    nyse = fdr.StockListing('NYSE')
    amex = fdr.StockListing('AMEX')
    
    print(f"NASDAQ: {len(nasdaq)}")
    print(f"NYSE: {len(nyse)}")
    print(f"AMEX: {len(amex)}")
    
    total = pd.concat([nasdaq, nyse, amex])
    print(f"Total US Stocks: {len(total)}")
    print(f"Time taken: {time.time() - start:.2f}s")
    
    # Check columns
    print("Columns:", total.columns)
    
    # Search test
    query = "Apple"
    results = total[total['Name'].str.contains(query, case=False, na=False)]
    print(f"Search '{query}':")
    print(results[['Symbol', 'Name']].head())

if __name__ == "__main__":
    test_us_loading()
