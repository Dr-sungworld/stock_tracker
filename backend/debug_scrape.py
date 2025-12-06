
import requests
from bs4 import BeautifulSoup
import re

url = "https://finance.naver.com/search/search.naver"
params = {"query": "삼성"}
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
}

response = requests.get(url, params=params, headers=headers)
# response.encoding = 'EUC-KR'
print(f"URL: {response.url}")
print(f"Status: {response.status_code}")
print(f"Encoding: {response.encoding}")

# Handle encoding manually
print("Trying EUC-KR decode...")
try:
    html = response.content.decode('euc-kr', errors='ignore')
    print("EUC-KR success")
except:
    print("EUC-KR failed")

print("Trying UTF-8 decode...")
try:
    html_utf8 = response.content.decode('utf-8', errors='ignore')
    print("UTF-8 success")
    if "삼성전자" in html_utf8:
         print("Found '삼성전자' in UTF-8 decoded content")
         html = html_utf8
    elif "삼성전자" in html:
         print("Found '삼성전자' in EUC-KR decoded content")
    else:
         print("Neither decoding found '삼성전자'")
except:
    pass

soup = BeautifulSoup(html, 'html.parser')
print(f"Title: {soup.title.string if soup.title else 'No Title'}")

tables = soup.find_all('table')
print(f"Found {len(tables)} tables")
for i, table in enumerate(tables):
    print(f"Table {i} classes: {table.get('class')}")

# Try to find specific section for stocks
# Sometimes it's inside a div with class 'section_search'
stock_section = soup.select_one('.section_search')
if stock_section:
    print("Found section_search")
    rows = stock_section.select('table.tbl_search tbody tr')
    print(f"Rows in section: {len(rows)}")
else:
    print("No section_search found")

# text dump
print("Contains '삼성전자':", "삼성전자" in soup.get_text())
print(soup.prettify()[:2000])

