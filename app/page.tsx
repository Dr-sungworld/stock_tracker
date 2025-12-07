'use client';

import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import HistoryChart from './components/HistoryChart';
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
  // Snapshot Logic
  const triggerSnapshot = async () => {
    if (!user) return;

    // Calculate Totals based on Current Data (Global & Split)
    let totalCurrent = 0;
    let totalInvested = 0;

    let krCurrent = 0;
    let krInvested = 0;

    let usCurrent = 0;
    let usInvested = 0;

    stocksData.forEach(stock => {
      const qty = stock.quantity || 1;
      const isUS = isUSStock(stock.code);

      const currentValKRW = getPriceInKRW(stock);
      const investedValKRW = getInvestedInKRW(stock);

      const itemCurrent = currentValKRW * qty;
      const itemInvested = investedValKRW * qty;

      totalCurrent += itemCurrent;
      totalInvested += itemInvested;

      if (isUS) {
        usCurrent += itemCurrent;
        usInvested += itemInvested;
      } else {
        krCurrent += itemCurrent;
        krInvested += itemInvested;
      }
    });

    if (totalInvested === 0) {
      console.warn("Total invested is 0, skipping snapshot");
      return;
    }

    try {
      await axios.post(`${API_URL}/history/snapshot`, {
        user_id: user,
        total_current: totalCurrent,
        total_invested: totalInvested,
        kr_current: krCurrent,
        kr_invested: krInvested,
        us_current: usCurrent,
        us_invested: usInvested
      });
      console.log("Snapshot saved. KR:", krCurrent, "US:", usCurrent);
      // Force chart refresh? It relies on next fetch.
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
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number>(1400); // Default fallback

  const isUSStock = (code: string) => /^[A-Za-z]+$/.test(code);

  const getPriceInKRW = (stock: Stock | StockData) => {
    // Current Price: If filteredData has currentPrice, use it.
    // Assuming stock object has currentPrice.
    const price = (stock as StockData).currentPrice || stock.buyPrice || 0;
    if (isUSStock(stock.code)) {
      return price * exchangeRate;
    }
    return price;
  };

  const getInvestedInKRW = (stock: Stock | StockData) => {
    if (isUSStock(stock.code)) {
      return stock.buyPrice * exchangeRate;
    }
    return stock.buyPrice;
  };
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
      // Show loading initially
      setStocksData(prev =>
        holdings.map(h => {
          const existing = prev.find(p => p.code === h.code);
          return existing ? { ...existing, loading: true } : { ...h, loading: true };
        })
      );

      const promises = holdings.map(async (stock) => {
        try {
          // Check if we already have data? No, let's refresh.
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
          // Return default/error state
          return {
            ...stock,
            loading: false,
            error: true,
            currentPrice: stock.buyPrice, // Fallback on error
          };
        }
      });

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
  const totalAsset = filteredData.reduce((acc, stock) => acc + ((stock.currentPrice || stock.buyPrice || 0) * (stock.quantity || 1)), 0);
  const totalInvest = filteredData.reduce((acc, stock) => acc + ((stock.buyPrice || 0) * (stock.quantity || 1)), 0);
  const totalProfit = totalAsset - totalInvest;
  const totalRoi = totalInvest > 0 ? (totalProfit / totalInvest) * 100 : 0;

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
      <HistoryChart userId={user} market={currentTab} />
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
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatCurrency(totalInvest)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>총 평가금액</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatCurrency(totalAsset)}</div>
            </div>
            <div className="text-right">
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>수익률</div>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: totalRoi > 0 ? 'var(--up-color)' : (totalRoi < 0 ? 'var(--down-color)' : 'white')
              }}>
                {totalRoi > 0 ? '+' : ''}{totalRoi.toFixed(2)}%
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: totalProfit > 0 ? 'var(--up-color)' : (totalProfit < 0 ? 'var(--down-color)' : 'white')
              }}>
                {totalProfit > 0 ? '+' : ''}{formatCurrency(totalProfit)}
              </div>
            </div>
          </div>
        )
      }

      {/* List Section */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {filteredData.map((stock, i) => {
          const isUS = isUSStock(stock.code);
          // Recalculate for display
          const currencySymbol = isUS ? '$' : '₩';
          const qty = stock.quantity || 1;

          const currentPrice = stock.currentPrice || 0;
          const buyPrice = stock.buyPrice || 0;

          const priceDisplay = isUS
            ? `$${currentPrice.toFixed(2)}`
            : `${currentPrice.toLocaleString()}₩`;

          const buyPriceDisplay = isUS
            ? `$${buyPrice.toFixed(2)}`
            : `${buyPrice.toLocaleString()}₩`;

          // Profit calc: (Current - Buy) * Qty
          // Display in native currency usually
          const profitNative = (currentPrice - buyPrice) * qty;
          const profitDisplay = isUS
            ? `${profitNative >= 0 ? '+' : ''}$${profitNative.toFixed(2)}`
            : `${profitNative >= 0 ? '+' : ''}${profitNative.toLocaleString()}₩`;

          const investedNative = buyPrice * qty;
          const roi = investedNative > 0 ? (profitNative / investedNative) * 100 : 0;

          return (
            <div key={i} className="glass-panel" style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: '40px', height: '40px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.2rem'
                }}>
                  {isUS ? '🇺🇸' : '🇰🇷'}
                </div>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{stock.name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#888' }}>{stock.code} • {stock.quantity} shares</div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold' }}>{priceDisplay}</div>
                <div style={{
                  fontSize: '0.9rem',
                  color: roi >= 0 ? '#00C853' : '#FF5252',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '0.5rem'
                }}>
                  <span>{profitDisplay}</span>
                  <span style={{
                    background: roi >= 0 ? 'rgba(0,200,83,0.2)' : 'rgba(255,82,82,0.2)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}>
                    {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleRemoveStock(stock.code)}
                style={{
                  background: 'none', border: 'none', color: '#666', cursor: 'pointer', marginLeft: '1rem'
                }}
              >
                ✕
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
