'use client';

import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import API_URL from './config';

interface Stock {
  name: string;
  code: string;
  buyPrice: number;
  market?: 'KR' | 'US';
}

interface StockData extends Stock {
  currentPrice?: number;
  rate?: number; // percentage
  change?: string;
  loading: boolean;
  error?: boolean;
}

export default function Home() {
  const [user, setUser] = useState<string>('');
  const [tempUser, setTempUser] = useState('');
  const [holdings, setHoldings] = useState<Stock[]>([]);
  const [stocksData, setStocksData] = useState<StockData[]>([]);

  // Search State
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ name: string, code: string, market?: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [selectedStock, setSelectedStock] = useState<{ name: string, code: string, market?: string } | null>(null);

  // Tab State
  const [currentTab, setCurrentTab] = useState<'KR' | 'US'>('KR');

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Check for saved user on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('stock-tracker-user');
    if (savedUser) {
      setUser(savedUser);
    }
  }, []);

  const handleLogin = () => {
    if (tempUser.trim()) {
      const u = tempUser.trim();
      setUser(u);
      localStorage.setItem('stock-tracker-user', u);
    }
  };

  const handleLogout = () => {
    setUser('');
    setHoldings([]);
    setStocksData([]);
    localStorage.removeItem('stock-tracker-user');
  };

  // Load from Backend (Per User)
  useEffect(() => {
    if (!user) return;
    const fetchHoldings = async () => {
      try {
        const res = await axios.get(`${API_URL}/holdings/${encodeURIComponent(user)}`);
        if (Array.isArray(res.data)) {
          setHoldings(res.data);
        } else {
          setHoldings([]);
        }
      } catch (e) {
        console.error("Failed to load stocks from server", e);
        setHoldings([]);
      }
    };
    fetchHoldings();
  }, [user]);

  // Save to Backend (Per User)
  useEffect(() => {
    if (!user) return;
    if (holdings.length >= 0) {
      const saveHoldings = async () => {
        try {
          await axios.post(`${API_URL}/holdings/${encodeURIComponent(user)}`, { holdings });
        } catch (e) {
          console.error("Failed to save stocks", e);
        }
      };
      const timeout = setTimeout(saveHoldings, 500);
      return () => clearTimeout(timeout);
    }
  }, [holdings, user]);

  // Fetch prices when holdings change or manually refreshed
  useEffect(() => {
    if (!user) return;
    const fetchPrices = async () => {
      const promises = holdings.map(async (stock) => {
        try {
          // Check if we already have data
          const existing = stocksData.find(s => s.code === stock.code);
          if (existing && !existing.error && existing.currentPrice) {
            // Optimistic update mechanism or just cache - for now always re-fetch on mount/add
          }

          // Fetch from Python Backend
          const res = await axios.get(`${API_URL}/price?code=${stock.code}`);
          const { price, rate, change } = res.data;
          return {
            ...stock,
            currentPrice: price,
            rate,
            change,
            loading: false,
          };
        } catch (err) {
          console.error(err);
          return {
            ...stock,
            loading: false,
            error: true,
          };
        }
      });

      // Show loading initially
      setStocksData(prev =>
        holdings.map(h => {
          const existing = prev.find(p => p.code === h.code);
          return existing ? { ...existing, loading: true } : { ...h, loading: true };
        })
      );

      const results = await Promise.all(promises);
      setStocksData(results);
    };

    if (holdings.length > 0) {
      fetchPrices();
    } else {
      setStocksData([]);
    }
  }, [holdings, user]);


  // Search Typeahead
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length > 0 && selectedStock?.name !== query) {
        try {
          const res = await axios.get(`${API_URL}/search?q=${encodeURIComponent(query)}`);
          setSuggestions(res.data.items);
          setShowSuggestions(true);
          setActiveIndex(-1);
        } catch (e) {
          console.error(e);
        }
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, selectedStock]);

  const handleSelectStock = (item: { name: string, code: string, market?: string }) => {
    setSelectedStock(item);
    setQuery(item.name);
    setShowSuggestions(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        handleSelectStock(suggestions[activeIndex]);
      }
    }
  };

  const handleAddStock = () => {
    if (!selectedStock || !buyPriceInput) return;
    const price = parseFloat(buyPriceInput.replace(/,/g, '')); // Allow decimals for US
    if (isNaN(price)) return;

    const newStock: Stock = {
      name: selectedStock.name,
      code: selectedStock.code,
      buyPrice: price,
      market: (selectedStock.market as 'KR' | 'US') || 'KR' // Default to KR if missing
    };

    setHoldings([...holdings, newStock]);

    // Reset
    setQuery('');
    setBuyPriceInput('');
    setSelectedStock(null);
  };

  const handleRemoveStock = (code: string) => {
    const updated = holdings.filter(h => h.code !== code);
    setHoldings(updated);
  };

  // Close suggestions on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [wrapperRef]);

  // Filtered Data for Display
  const filteredData = stocksData.filter(s => (s.market || 'KR') === currentTab);

  // Summary Calculation (Global or Per Tab? User requested separation, usually separated summaries are better)
  // Let's do Per Tab Summary
  const totalInvested = filteredData.reduce((acc, s) => acc + (s.buyPrice || 0), 0);
  const totalCurrent = filteredData.reduce((acc, s) => acc + (s.currentPrice || s.buyPrice || 0), 0);
  const totalReturn = totalCurrent - totalInvested;
  const totalRate = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

  const currencySymbol = currentTab === 'KR' ? '원' : '$';
  const formatCurrency = (val: number) => {
    if (currentTab === 'KR') return val.toLocaleString() + '원';
    return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (!user) {
    return (
      <main className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-panel" style={{ padding: '3rem', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h1>Welcome</h1>
          <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>이름을 입력하여 시작하세요</p>
          <input
            type="text"
            placeholder="이름 (예: Sung)"
            value={tempUser}
            onChange={e => setTempUser(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ marginBottom: '1rem' }}
          />
          <button className="btn-primary" style={{ width: '100%' }} onClick={handleLogin}>로그인</button>
        </div>
      </main>
    )
  }

  return (
    <main className="container">
      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1>Stock Tracker</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{user}님</span>
            <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.1)', fontSize: '0.8rem', padding: '0.5rem 1rem', color: 'white' }}>Logout</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setCurrentTab('KR')}
            style={{
              padding: '0.8rem 1.5rem',
              background: currentTab === 'KR' ? 'rgba(255,255,255,0.15)' : 'transparent',
              border: 'none',
              borderBottom: currentTab === 'KR' ? '2px solid var(--primary-color, #00C853)' : '2px solid transparent',
              color: currentTab === 'KR' ? 'white' : 'var(--text-secondary)',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
          >
            국내 주식 (KR)
          </button>
          <button
            onClick={() => setCurrentTab('US')}
            style={{
              padding: '0.8rem 1.5rem',
              background: currentTab === 'US' ? 'rgba(255,255,255,0.15)' : 'transparent',
              border: 'none',
              borderBottom: currentTab === 'US' ? '2px solid var(--primary-color, #00C853)' : '2px solid transparent',
              color: currentTab === 'US' ? 'white' : 'var(--text-secondary)',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
          >
            해외 주식 (US)
          </button>
        </div>

        {/* Input Section */}
        <div className="input-group">
          {/* Input fields same as before, logic uses currentTab indirectly? 
                Actually, the user searches and ADDS. 
                If they search a US stock while on KR tab, should we switch tab? 
                Or just add it and it appears on the US tab? 
                Better: Show market in suggestion and let user know. 
            */}
          <div style={{ flex: 1, position: 'relative' }} ref={wrapperRef}>
            <input
              type="text"
              placeholder="종목명 (Search...)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedStock && e.target.value !== selectedStock.name) {
                  setSelectedStock(null);
                }
              }}
              onKeyDown={handleKeyDown}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions">
                {suggestions.map((s, idx) => (
                  <div
                    key={idx}
                    className={`suggestion-item ${idx === activeIndex ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input blur
                      handleSelectStock(s);
                    }}
                  >
                    {s.name}
                    <span style={{ fontSize: '0.8em', color: '#888', marginLeft: '0.5rem' }}>
                      {s.code}
                      {s.market && <span style={{ marginLeft: '4px', padding: '2px 4px', borderRadius: '4px', background: s.market === 'US' ? '#2962FF' : '#00C853', color: 'white', fontSize: '10px' }}>{s.market}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input
            type="number"
            placeholder={currentTab === 'KR' ? "매입가 (원)" : "매입가 ($)"}
            value={buyPriceInput}
            onChange={(e) => setBuyPriceInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddStock()}
            style={{ width: '150px' }}
            className="mobile-full"
            step={currentTab === 'US' ? "0.01" : "1"}
          />
          <button className="btn-primary mobile-full" onClick={handleAddStock}>
            추가
          </button>
        </div>
      </div>

      {/* Summary Section */}
      {filteredData.length > 0 && (
        <div className="glass-panel summary-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>총 매입금액</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatCurrency(totalInvested)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>총 평가금액</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatCurrency(totalCurrent)}</div>
          </div>
          <div className="text-right">
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>수익률</div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: totalRate > 0 ? 'var(--up-color)' : (totalRate < 0 ? 'var(--down-color)' : 'white')
            }}>
              {totalRate > 0 ? '+' : ''}{totalRate.toFixed(2)}%
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: totalReturn > 0 ? 'var(--up-color)' : (totalReturn < 0 ? 'var(--down-color)' : 'white')
            }}>
              {totalReturn > 0 ? '+' : ''}{formatCurrency(totalReturn)}
            </div>
          </div>
        </div>
      )}

      {/* List Section */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {filteredData.map((stock, i) => {
          const isProfit = (stock.rate || 0) > 0;
          const isLoss = (stock.rate || 0) < 0;
          const rateColor = isProfit ? 'var(--up-color)' : (isLoss ? 'var(--down-color)' : 'white');

          // ROI Calculation
          const stockReturn = (stock.currentPrice || 0) - stock.buyPrice;
          const stockRoi = stock.buyPrice > 0 ? (stockReturn / stock.buyPrice) * 100 : 0;
          const roiColor = stockRoi > 0 ? 'var(--up-color)' : (stockRoi < 0 ? 'var(--down-color)' : 'white');

          return (
            <div key={i} className="glass-panel card flex-between">
              <div>
                <h3 style={{ margin: '0 0 0.2rem 0' }}>{stock.name}</h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{stock.code}</div>
              </div>

              <div className="text-right" style={{ flex: 1, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>매입가</div>
                  <div>{formatCurrency(stock.buyPrice)}</div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>현재가</div>
                  <div style={{ fontWeight: 'bold', color: rateColor }}>
                    {stock.currentPrice ? formatCurrency(stock.currentPrice) : 'Loading...'}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>수익률</div>
                  <div style={{ fontWeight: 'bold', color: roiColor }}>
                    {stockRoi > 0 ? '+' : ''}{stockRoi.toFixed(2)}%
                    <span style={{ fontSize: '0.8rem', marginLeft: '5px', color: roiColor }}>
                      ({stockReturn > 0 ? '+' : ''}{formatCurrency(stockReturn)})
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleRemoveStock(stock.code)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ff5252',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  marginLeft: '1rem'
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {
        stocksData.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
            보유한 종목을 추가해주세요.
            <br /><br />
            {user && (
              <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: '20px', padding: '10px', borderTop: '1px solid #eee' }}>
                Debug Info:<br />
                User: {user}<br />
                Holdings: {holdings.length}<br />
                API: {API_URL}
              </div>
            )}
          </div>
        )
      }
    </main>
  );
}
