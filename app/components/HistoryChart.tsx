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

interface HisotryItem {
    date: string;
    total_current_value: number;
    total_invested_value: number;
    daily_return_rate: number;
}

interface Props {
    userId: string;
}

const HistoryChart: React.FC<Props> = ({ userId }) => {
    const [data, setData] = useState<HisotryItem[]>([]);
    const [range, setRange] = useState('1M');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!userId) return;
        fetchHistory();
    }, [userId, range]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${process.env.NEXT_PUBLIC_API_URL}/history/${userId}?range=${range}`);
            setData(response.data);
        } catch (e) {
            console.error("Failed to fetch history", e);
        } finally {
            setLoading(false);
        }
    };

    const formatXAxis = (tickItem: string) => {
        // Format YYYY-MM-DD to MM/DD
        const date = new Date(tickItem);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(val);
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Portfolio History 📈</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {['1W', '1M', '3M', '1Y', 'ALL'].map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            style={{
                                background: range === r ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                border: 'none',
                                padding: '0.3rem 0.8rem',
                                borderRadius: '5px',
                                color: 'white',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                            }}
                        >
                            {r}
                        </button>
                    ))}
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
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#00C853" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#00C853" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: '#888', fontSize: 12 }}
                                tickFormatter={formatXAxis}
                                minTickGap={30}
                            />
                            <YAxis
                                tick={{ fill: '#888', fontSize: 12 }}
                                tickFormatter={(val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : (val / 1000).toFixed(0) + 'k'}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#222', border: '1px solid #444' }}
                                formatter={(value: number) => [formatCurrency(value), "Value"]}
                                labelFormatter={(label) => new Date(label).toLocaleDateString()}
                            />
                            <Area
                                type="monotone"
                                dataKey="total_current_value"
                                stroke="#00C853"
                                fillOpacity={1}
                                fill="url(#colorValue)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

export default HistoryChart;
