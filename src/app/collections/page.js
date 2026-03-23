'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/* ââ helpers ââ */
const fmt = v => {
  const n = Number(v);
  if (isNaN(n)) return v;
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return n.toLocaleString('en-IN');
};
const pct = v => { const n = Number(v); return isNaN(n) ? v : n.toFixed(1) + '%'; };
const riskColor = tag => {
  if (!tag) return '#888';
  const t = String(tag).toLowerCase();
  if (t.includes('red alert')) return '#dc2626';
  if (t.includes('critical')) return '#ea580c';
  if (t.includes('high')) return '#f59e0b';
  return '#22c55e';
};

const KPI = ({ label, value, sub, color }) => (
  <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', minWidth: 180,
    boxShadow: '0 1px 3px rgba(0,0,0,.08)', borderLeft: `4px solid ${color || '#3b82f6'}` }}>
    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: color || '#1e293b' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
  </div>
);

/* ââ sub-tabs config ââ */
const SUB_TABS = [
  { id: 'summary', label: 'City Summary', api: 'coll-summary' },
  { id: 'hospital', label: 'Hospital', api: 'coll-hospital' },
  { id: 'partner', label: 'Partner', api: 'coll-partner' },
  { id: 'employee', label: 'Employee', api: 'coll-employee' },
  { id: 'trend', label: 'Trends', api: 'coll-trend' },
  { id: 'ageing', label: 'Ageing Detail', api: 'coll-ageing' },
  { id: 'b2h', label: 'B2H Summary', api: 'coll-b2h' },
];

/* ââ main module ââ */
function CollectionsModule({ token, userCities }) {
  const [subTab, setSubTab] = useState('summary');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  /* Date filter state */
  const today = new Date();
  const mtdStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmtDate = d => d.toISOString().slice(0, 10);

  const [dateType, setDateType] = useState('wallet'); // 'wallet' or 'payment'
  const [startDate, setStartDate] = useState(fmtDate(mtdStart));
  const [endDate, setEndDate] = useState(fmtDate(today));

  const fetchData = useCallback(async () => {
    const tab = SUB_TABS.find(t => t.id === subTab);
    if (!tab) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type: tab.api, token });

      if (dateType === 'wallet') {
        params.set('walletStart', startDate);
        params.set('walletEnd', endDate);
      } else {
        params.set('paymentStart', startDate);
        params.set('paymentEnd', endDate);
      }

      if (userCities && userCities.length) params.set('cities', userCities.join(','));

      const res = await fetch('/api/data?' + params.toString());
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'API error ' + res.status);
      }
      const json = await res.json();
      setData(json.data || json);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [subTab, token, dateType, startDate, endDate, userCities]);

  useEffect(() => { if (token) fetchData(); }, [fetchData, token]);

  /* ââ smart column formatting ââ */
  const formatCell = (key, val) => {
    if (val === null || val === undefined) return '-';
    const k = key.toLowerCase();
    if (k.includes('risk') || k.includes('tag')) return (
      <span style={{ color: riskColor(val), fontWeight: 600 }}>{val}</span>
    );
    if (k.includes('pct') || k.includes('percent') || k.includes('efficiency') || k.includes('rate'))
      return pct(val);
    if (k.includes('amount') || k.includes('outstanding') || k.includes('received') || k.includes('wallet') ||
        k.includes('revenue') || k.includes('total') || k.includes('overdue') || k.includes('avg'))
      return fmt(val);
    if (k.includes('count') || k.includes('bucket') || k.includes('days'))
      return Number(val).toLocaleString('en-IN');
    return String(val);
  };

  const rows = Array.isArray(data) ? data : [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div>
      {/* ââ Date filter bar ââ */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Date Type</label>
          <select value={dateType} onChange={e => setDateType(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, minWidth: 200, cursor: 'pointer' }}>
            <option value="wallet">Wallet Created Date</option>
            <option value="payment">Payment Received Date</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 }} />
        </div>
        <div style={{ alignSelf: 'flex-end' }}>
          <button onClick={fetchData}
            style={{ padding: '8px 24px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Refresh
          </button>
        </div>
      </div>

      {/* ââ KPI cards (summary tab) ââ */}
      {subTab === 'summary' && rows.length > 0 && (() => {
        const totals = rows.reduce((acc, r) => {
          acc.wallet += Number(r.TOTAL_WALLET_AMOUNT || 0);
          acc.received += Number(r.PAYMENT_RECEIVED || 0);
          acc.outstanding += Number(r.OUTSTANDING_AMOUNT || 0);
          acc.overdue += Number(r.OVERDUE_AMOUNT || 0);
          return acc;
        }, { wallet: 0, received: 0, outstanding: 0, overdue: 0 });
        const eff = totals.wallet > 0 ? (totals.received / totals.wallet * 100) : 0;
        return (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <KPI label="Total Wallet" value={fmt(totals.wallet)} color="#3b82f6" />
            <KPI label="Payment Received" value={fmt(totals.received)} color="#22c55e" />
            <KPI label="Outstanding" value={fmt(totals.outstanding)} color="#f59e0b" />
            <KPI label="Collection Efficiency" value={pct(eff)} color={eff >= 80 ? '#22c55e' : '#dc2626'} />
            <KPI label="Overdue" value={fmt(totals.overdue)} color="#dc2626" />
          </div>
        );
      })()}

      {/* ââ Sub-tabs ââ */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid #e5e7eb' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{ padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: subTab === t.id ? 700 : 400,
              color: subTab === t.id ? '#2563eb' : '#64748b', background: 'transparent',
              borderBottom: subTab === t.id ? '3px solid #2563eb' : '3px solid transparent',
              transition: 'all .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ââ Content ââ */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.08)', minHeight: 200 }}>
        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div>}
        {error && <div style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>Error: {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>No collection data found for selected date range</div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb',
                      color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12, textTransform: 'uppercase' }}>
                      {c.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    {cols.map(c => (
                      <td key={c} style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                        {formatCell(c, r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ââ Page wrapper with auth ââ */
export default function CollectionsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('dash_token') : null;
    if (!t) { router.push('/login'); return; }
    setToken(t);
    fetch('/api/auth?token=' + t)
      .then(r => r.json())
      .then(d => {
        if (!d.authenticated) { localStorage.removeItem('dash_token'); router.push('/login'); return; }
        setUser(d.user);
        setChecked(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  if (!checked) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <div style={{ color: '#888', fontSize: 16 }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ background: '#c0392b', color: '#fff', padding: '12px 24px', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Collections &amp; Payments Dashboard</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ background: 'rgba(255,255,255,0.2)', padding: '4px 14px', borderRadius: 4, fontSize: 13 }}>
            {user?.name} ({user?.role?.toUpperCase()})
          </span>
          <button onClick={() => router.push('/')}
            style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', border: 'none', padding: '6px 16px',
              borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Back to Dashboard
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        <CollectionsModule token={token} userCities={user?.allowedCities || []} />
      </div>
    </div>
  );
}
