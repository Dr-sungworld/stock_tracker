"use client";

import axios from 'axios';
import React, { useEffect, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis, YAxis
} from 'recharts';
import API_URL from '../config';

interface HistoryItem {
    date: string;
    created_at?: string;
    total_current_value: number;
    total_invested_value: number;
    daily_return: number;      // Profit ($/₩)
    daily_return_rate: number; // ROI (%)

    kr_current_value?: number;
    kr_return?: number;
    kr_rate?: number;

    us_current_value?: number;
    us_return?: number;
    us_rate?: number;
}

interface Props {
    userId: string;
    market?: 'KR' | 'US';
}

type MetricType = 'profit' | 'rate' | 'value';

const HistoryChart: React.FC<Props> = ({ userId, market }) => {
    const [data, setData] = useState<HistoryItem[]>([]);
    const [range, setRange] = useState('1M');
    const [metric, setMetric] = useState<MetricType>('profit');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!userId) return;
        fetchHistory();
    }, [userId, range]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_URL}/history/${encodeURIComponent(userId)}?range=${range}`);
            setData(response.data);
        } catch (e) {
            console.error("Failed to fetch history", e);
        } finally {
            setLoading(false);
        }
    };

    const getDataKey = () => {
        // Switch based on market prop
        const prefix = market === 'KR' ? 'kr_' : (market === 'US' ? 'us_' : '');

        if (metric === 'profit') return prefix ? `${prefix}return` : 'daily_return';
        if (metric === 'rate') return prefix ? `${prefix}rate` : 'daily_return_rate';
        return prefix ? `${prefix}current_value` : 'total_current_value';
    };

    // Calculate Gradient Offset
    const getGradientOffset = () => {
        const dataKey = getDataKey();
        if (data.length === 0) return 0;

        const dataMax = Math.max(...data.map((i) => (i as any)[dataKey] || 0));
        const dataMin = Math.min(...data.map((i) => (i as any)[dataKey] || 0));

        if (dataMax <= 0) return 0;
        if (dataMin >= 0) return 1;

        return dataMax / (dataMax - dataMin);
    };

    const off = getGradientOffset();

    const getLabel = () => {
        const m = market === 'KR' ? '(Domestic)' : (market === 'US' ? '(Overseas)' : '');
        if (metric === 'profit') return `수익금 ${m}`;
        if (metric === 'rate') return `수익률 ${m}`;
        return `평가금액 ${m}`;
    };

    const formatXAxis = (tickItem: string) => {
        if (!tickItem) return '';
        const date = new Date(tickItem);
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const hours = date.getHours();
        const min = date.getMinutes();
        return `${month}/${day} ${hours}:${min < 10 ? '0' + min : min}`;
    };

    const formatYAxis = (val: number) => {
        if (metric === 'rate') return `${val.toFixed(1)}%`;
        if (Math.abs(val) >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
        return val.toString();
    };

    const formatTooltip = (val: number) => {
        if (metric === 'rate') return `${val.toFixed(2)}%`;
        // Use currency formatting appropriate for the market?
        // KR -> KRW, US -> USD?
        // Or consistency? Let's use currency symbol based on market/value.
        // Actually, logic is tricky because internal values are all KRW based on backend?
        // Wait, US stock values were converted to KRW for storage in `triggerSnapshot` update!
        // So everything is in KRW in the DB!
        // User asked for "Overseas value" - if stored in KRW, it shows in KRW.
        // If user wants USD, I should have stored USD.
        // Re-reading user request: "accurately display their total portfolio value... regardless of ... domestic or international".
        // And "individual stock performance ... displayed in its native currency".
        // But for Global Graph, it MUST be one currency (KRW).
        // For "US Only" Graph, does user want USD or KRW?
        // Usually, if "Overseas Tab" is selected, they see USD in list.
        // They probably expect USD graph unless specified.
        // But my DB column `us_current_value` stores KRW converted value?
        // Let's re-read stored logic: `usCurrent += itemCurrent` where `itemCurrent = currentValKRW * qty`.
        // YES, I stored KRW.
        // So graph will show KRW. This is "safe" / consistent with "Portfolio Value".
        // If they want USD, I would need to store USD separately or divide by exchange rate.
        // For now, assume KRW is fine for graph, as it represents "Asset Value in Main Currency".
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(val);
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0 }}>Portfolio History 📈</h3>

                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                        {['1W', '1M', '3M', '1Y', 'ALL'].map((r) => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                style={{
                                    background: range === r ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: '4px',
                                    color: 'white',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer'
                                }}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '8px', width: 'fit-content' }}>
                    <button
                        onClick={() => setMetric('profit')}
                        style={{
                            background: metric === 'profit' ? 'rgba(255,255,255,0.15)' : 'transparent',
                            border: 'none',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '5px',
                            color: metric === 'profit' ? 'white' : '#888',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        수익금 (Profit)
                    </button>
                    <button
                        onClick={() => setMetric('rate')}
                        style={{
                            background: metric === 'rate' ? 'rgba(255,255,255,0.15)' : 'transparent',
                            border: 'none',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '5px',
                            color: metric === 'rate' ? 'white' : '#888',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        수익률 (ROI)
                    </button>
                    <button
                        onClick={() => setMetric('value')}
                        style={{
                            background: metric === 'value' ? 'rgba(255,255,255,0.15)' : 'transparent',
                            border: 'none',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '5px',
                            color: metric === 'value' ? 'white' : '#888',
                            cursor: 'pointer',
                            fontSize: '0.85rem'
                        }}
                    >
                        평가금 (Value)
                    </button>
                </div>
            </div>

            <div style={{ height: '300px', width: '100%' }}>
                {loading ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>
                ) : data.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        No history data yet. Save your portfolio to create a snapshot!
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                            <defs>
                                <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset={off} stopColor="#00C853" stopOpacity={0.8} />
                                    <stop offset={off} stopColor="#FF5252" stopOpacity={0.8} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis
                                dataKey="created_at"
                                tick={{ fill: '#888', fontSize: 10 }}
                                tickFormatter={formatXAxis}
                                minTickGap={30}
                            />
                            <YAxis
                                tick={{ fill: '#888', fontSize: 11 }}
                                tickFormatter={formatYAxis}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#222', border: '1px solid #444' }}
                                formatter={(value: number) => [formatTooltip(value), getLabel()]}
                                labelFormatter={(label) => {
                                    const d = new Date(label);
                                    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey={getDataKey()}
                                fill={metric === 'value' ? "rgba(33, 150, 243, 0.3)" : "url(#splitColor)"}
                                stroke={metric === 'value' ? "#2196F3" : "url(#splitColor)"}
                                strokeWidth={2}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

export default HistoryChart;
