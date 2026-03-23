'use client';
import { useState, useEffect, useCallback } from 'react';

const fmt = v => {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  if (isNaN(n)) return v;
  if (Math.abs(n) >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 100000) return (n / 100000).toFixed(2) + ' L';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + ' K';
  return n.toFixed(0);
};

const pct = v => {
  if (v === null || v === undefined) return '-';
  return Number(v).toFixed(1) + '%';
};

const KPI = ({ label, value, sub, color }) => (
  <div className="bg-white rounded-lg shadow p-4 border-l-4" style={{ borderColor: color || '#3b82f6' }}>
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="text-2xl font-bold mt-1" style={{ color: color || '#1e40af' }}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
  </div>
);

const riskColor = tag => {
  if (tag === 'Red Alert') return '#dc2626';
  if (tag === 'Critical') return '#ea580c';
  if (tag === 'High') return '#f59e0b';
  return '#22c55e';
};

export default function CollectionsModule({ token, dates, userCities }) {
  const [subTab, setSubTab] = useState('summary');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({});
  const [walletStart, setWalletStart] = useState(dates?.mtdStart || '');
  const [walletEnd, setWalletEnd] = useState(dates?.mtdEnd || '');
  const [paymentStart, setPaymentStart] = useState(dates?.mtdStart || '');
  const [paymentEnd, setPaymentEnd] = useState(dates?.today || '');

  const subTabs = [
    { id: 'summary', label: 'City Summary' },
    { id: 'hospital', label: 'Hospital' },
    { id: 'partner', label: 'Partner' },
    { id: 'employee', label: 'Employee' },
    { id: 'trend', label: 'Trends' },
    { id: 'ageing', label: 'Ageing Detail' },
    { id: 'b2h', label: 'B2H Summary' },
  ];

  const fetchData = useCallback(async (type) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: 'coll-' + type,
        token,
        walletStart,
        walletEnd,
        paymentStart,
        paymentEnd,
      });
      const res = await fetch('/api/data?' + params.toString());
      const json = await res.json();
      if (json.data) {
        setData(prev => ({ ...prev, [type]: json.data }));
      }
    } catch (e) {
      console.error('Collection fetch error:', e);
    }
    setLoading(false);
  }, [token, walletStart, walletEnd, paymentStart, paymentEnd]);

  useEffect(() => {
    if (token && walletStart) {
      fetchData(subTab);
    }
  }, [subTab, token, walletStart, walletEnd, paymentStart, paymentEnd, fetchData]);

  const rows = data[subTab] || [];

  // KPI totals for summary
  const summaryTotals = (data.summary || []).reduce((acc, r) => ({
    margin: acc.margin + Number(r.TOTAL_MARGIN || 0),
    bank: acc.bank + Number(r.TOTAL_AT_BANK || 0),
    outInt: acc.outInt + Number(r.TOTAL_OUTSTANDING_INTERNAL || 0),
    outPart: acc.outPart + Number(r.TOTAL_OUTSTANDING_PARTNER || 0),
    pending: acc.pending + Number(r.PENDING_COLLECTION || 0),
    orders: acc.orders + Number(r.TOTAL_ORDERS || 0),
  }), { margin: 0, bank: 0, outInt: 0, outPart: 0, pending: 0, orders: 0 });

  const effPct = summaryTotals.margin > 0
    ? ((summaryTotals.bank / summaryTotals.margin) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-4">
      {/* Date Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wallet Start</label>
          <input type="date" value={walletStart} onChange={e => setWalletStart(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Wallet End</label>
          <input type="date" value={walletEnd} onChange={e => setWalletEnd(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Start</label>
          <input type="date" value={paymentStart} onChange={e => setPaymentStart(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment End</label>
          <input type="date" value={paymentEnd} onChange={e => setPaymentEnd(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm" />
        </div>
        <button onClick={() => fetchData(subTab)}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700">
          Refresh
        </button>
      </div>

      {/* KPI Cards - only show on summary tab */}
      {subTab === 'summary' && data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPI label="Total Orders" value={fmt(summaryTotals.orders)} color="#3b82f6" />
          <KPI label="Total Margin" value={fmt(summaryTotals.margin)} sub="Wallet Amount" color="#8b5cf6" />
          <KPI label="At Bank" value={fmt(summaryTotals.bank)} sub="Collected" color="#22c55e" />
          <KPI label="Outstanding (Staff)" value={fmt(summaryTotals.outInt)} color="#f59e0b" />
          <KPI label="Outstanding (Partner)" value={fmt(summaryTotals.outPart)} color="#ea580c" />
          <KPI label="Collection %" value={pct(effPct)} sub="Efficiency" color={Number(effPct) > 80 ? '#22c55e' : '#dc2626'} />
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-white rounded-lg shadow p-1 overflow-x-auto">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors ${
              subTab === t.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-gray-500">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
          <div>Loading collections data...</div>
        </div>
      )}

      {/* Data Tables */}
      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {Object.keys(rows[0]).map(col => (
                  <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b">
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b hover:bg-blue-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  {Object.entries(row).map(([col, val], j) => {
                    const isRisk = col === 'RISK_TAG';
                    const isFlag = col.includes('FLAG');
                    const isPct = col.includes('PCT') || col.includes('EFFICIENCY');
                    const isAmt = col.includes('MARGIN') || col.includes('BANK') || col.includes('OUTSTANDING') || col.includes('PENDING') || col.includes('AMT') || col.includes('AMOUNT') || col.includes('VALUE') || col.includes('COST') || col.includes('PAYABLE') || col.includes('COLLECTED');
                    return (
                      <td key={j} className="px-3 py-2 whitespace-nowrap" style={isRisk ? { color: riskColor(val), fontWeight: 600 } : {}}>
                        {isFlag ? (val ? 'â ï¸' : 'â') : isPct ? pct(val) : isAmt ? fmt(val) : (val ?? '-')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-12 text-gray-400 bg-white rounded-lg shadow">
          <div className="text-4xl mb-2">ð</div>
          <div>No collection data found for selected date range</div>
        </div>
      )}
    </div>
  );
}
