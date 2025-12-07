'use client';

import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import API_URL from './config';

interface Stock {
  name: string;
  code: string;
  buyPrice: number;
  quantity: number; // New Field: defaults to 1 if missing
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
  // ... (existing state)

  // Snapshot Logic
  const triggerSnapshot = async () => {
    // Calculate Totals based on Current Data
    // We need to match stocksData with holdings to get latest price
    let totalCurrent = 0;
    let totalInvested = 0;

    // Use stocksData if available (it has current prices)
    // But stocksData depends on filteredData? No, stocksData is all fetched.
    // Wait, stocksData might be incomplete if we haven't fetched everything.
    // But usually we fetch all holdings on load.

    // Recalculate totals from stocksData which merges holding info
    // Actually, we can just use the same logic as the Summary section?
    // The Summary logic filters by Tab, but Snapshot should be GLOBAL (Total Portfolio).

    // Let's iterate over ALL stocksData (which represents all holdings populated with price)
    stocksData.forEach(stock => {
      const qty = stock.quantity || 1;
      const current = stock.currentPrice || stock.buyPrice; // Fallback? No, if 0 it's 0.
      const invested = stock.buyPrice * qty;

      if (stock.currentPrice) {
        totalCurrent += stock.currentPrice * qty;
      } else {
        // If price not loaded, do we assume 0 or buyPrice?
        // Safest is to NOT snapshot if data is missing.
        // But for now let's assume if it's missing, it counts as 0 or we skip snapshot.
        // Let's use 0 current value for missing price stocks to reflect "unknown".
      }
      totalInvested += invested;
    });

    if (totalInvested === 0) return; // Empty portfolio or logic error

    try {
      await axios.post(`${API_URL}/history/snapshot`, {
        user_id: user,
        total_current: totalCurrent,
        total_invested: totalInvested
      });
      console.log("Snapshot saved");
    } catch (e) {
      console.error("Snapshot failed", e);
    }
  };

  const handleManualSave = async () => {
    setIsSaving(true);
    try {
      await axios.post(`${API_URL}/holdings/${user}`, { holdings });

      // Trigger History Snapshot
      await triggerSnapshot();

      alert('저장되었습니다. (Saved)');
    } catch (e) {
      alert('저장 실패 (Save Failed)');
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const [stocksData, setStocksData] = useState<StockData[]>([]);

  // Search State
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ name: string, code: string, market?: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('1'); // Default Qty = 1
  const [selectedStock, setSelectedStock] = useState<{ name: string, code: string, market?: string } | null>(null);

  // Tab State
  const [currentTab, setCurrentTab] = useState<'KR' | 'US'>('KR');
  const [isLoaded, setIsLoaded] = useState(false); // Guard against overwriting DB
  const [isSaving, setIsSaving] = useState(false); // Manual save feedback

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
    setIsLoaded(false); // Reset load state
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
        // Do NOT wipe local state on error, and do NOT allow saving empty state
        alert("Failed to load data from server. Please refresh or check connection.");
        return; // Exit without setting isLoaded(true)
      }
      // Only mark as loaded if success (or empty list returned from server successfully)
      setIsLoaded(true);
    };
    fetchHoldings();
  }, [user]);



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
    if (!selectedStock || !buyPriceInput || !quantityInput) return;
    const price = parseFloat(buyPriceInput.replace(/,/g, ''));
    const qty = parseInt(quantityInput.replace(/,/g, ''));

    if (isNaN(price) || isNaN(qty) || qty <= 0) return;

    // Check if stock exists
    const existingIndex = holdings.findIndex(h => h.code === selectedStock.code);

    if (existingIndex >= 0) {
      // Aggregate
      const existing = holdings[existingIndex];
      const existingQty = existing.quantity || 1;
      const existingTotal = existing.buyPrice * existingQty;
      const newTotal = price * qty;

      const distinctTotalQty = existingQty + qty;
      const distinctAvgPrice = (existingTotal + newTotal) / distinctTotalQty;

      const updatedStock = {
        ...existing,
        buyPrice: distinctAvgPrice,
        quantity: distinctTotalQty
      };

      const newHoldings = [...holdings];
      newHoldings[existingIndex] = updatedStock;
      setHoldings(newHoldings);
    } else {
      // Add New
      const newStock: Stock = {
        name: selectedStock.name,
        code: selectedStock.code,
        buyPrice: price,
        quantity: qty,
        market: (selectedStock.market as 'KR' | 'US') || 'KR'
      };
      setHoldings([...holdings, newStock]);
    }

    // Reset
    setQuery('');
    setBuyPriceInput('');
    setQuantityInput('1');
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
  const totalInvested = filteredData.reduce((acc, s) => acc + ((s.buyPrice || 0) * (s.quantity || 1)), 0);
  const totalCurrent = filteredData.reduce((acc, s) => acc + ((s.currentPrice || s.buyPrice || 0) * (s.quantity || 1)), 0);
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
      <HistoryChart userId={user} />
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

        {/* Manual Save Button */}
        <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
          <button
            onClick={handleManualSave}
            disabled={isSaving}
            className="btn-primary"
            style={{
              background: isSaving ? '#888' : '#2196F3',
              padding: '0.5rem 1.5rem',
              fontSize: '0.9rem'
            }}
          >
            {isSaving ? 'Saving...' : '현재 상태 저장 (Save)'}
          </button>
        </div>

        {/* Input Section */}
        <div className="input-group" style={{ flexDirection: 'column', gap: '1rem' }}>
          {/* Row 1: Search */}
          <div style={{ position: 'relative', width: '100%' }} ref={wrapperRef}>
            <input
              type="text"
              placeholder="종목명 검색 (예: 삼성전자)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedStock && e.target.value !== selectedStock.name) {
                  setSelectedStock(null);
                }
              }}
              onKeyDown={handleKeyDown}
              style={{ width: '100%' }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions" style={{ top: '100%', left: 0, right: 0 }}>
                {suggestions.map((s, idx) => (
                  <div
                    key={idx}
                    className={`suggestion-item ${idx === activeIndex ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectStock(s);
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
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

          {/* Row 2: Price / Qty / Add - Grid Layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr) minmax(auto, 0.8fr)', gap: '0.5rem', width: '100%' }}>

            <div>
              <input
                type="number"
                placeholder={currentTab === 'KR' ? "매입가 (원)" : "매입가 ($)"}
                value={buyPriceInput}
                onChange={(e) => setBuyPriceInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStock()}
                style={{ width: '100%', minWidth: 0 }}
                step={currentTab === 'US' ? "0.01" : "1"}
              />
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: '-18px', left: '0', fontSize: '0.7rem', color: '#aaa' }}>수량</div>
              <input
                type="number"
                placeholder="수량"
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStock()}
                style={{ width: '100%', minWidth: 0 }}
                min="1"
              />
            </div>

            <button className="btn-primary" onClick={handleAddStock} style={{ whiteSpace: 'nowrap', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              추가
            </button>
          </div>
        </div>
      </div>

      {/* Summary Section */}
      {
        filteredData.length > 0 && (
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
        )
      }

      {/* List Section */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {filteredData.map((stock, i) => {
          const isProfit = (stock.rate || 0) > 0;
          const isLoss = (stock.rate || 0) < 0;
          const rateColor = isProfit ? 'var(--up-color)' : (isLoss ? 'var(--down-color)' : 'white');

          // ROI Calculation
          const qty = stock.quantity || 1; // Fallback for old data
          const currentVal = (stock.currentPrice || 0);
          const totalVal = currentVal * qty;
          const investedVal = stock.buyPrice * qty;

          const stockReturn = totalVal - investedVal;
          const stockRoi = investedVal > 0 ? (stockReturn / investedVal) * 100 : 0;
          const roiColor = stockRoi > 0 ? 'var(--up-color)' : (stockRoi < 0 ? 'var(--down-color)' : 'white');

          return (
            <div key={i} className="glass-panel card flex-between">
              <div>
                <h3 style={{ margin: '0 0 0.2rem 0' }}>{stock.name}</h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {stock.code}
                </div>
              </div>

              <div className="text-right" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                <div style={{ textAlign: 'right', minWidth: '70px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>매입가</div>
                  <div>{formatCurrency(stock.buyPrice)}</div>
                </div>

                <div style={{ textAlign: 'right', minWidth: '40px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>수량</div>
                  <div>{qty}</div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>평가금 (Total)</div>
                  <div style={{ fontWeight: 'bold', color: rateColor }}>
                    {stock.currentPrice ? formatCurrency(totalVal) : 'Loading...'}
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
    </main >
  );
}
