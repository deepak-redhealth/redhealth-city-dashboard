'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function CollectionsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dateType = 'order_date'; // order creation date (UTC→IST)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [activeTab, setActiveTab] = useState('summary');
  const [empStatus, setEmpStatus] = useState('All');
  const [ageingFilter, setAgeingFilter] = useState(null);
  const [data, setData] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Client-side filters (applied on fetched data)
  const [filterCity, setFilterCity] = useState('');
  const [filterHospital, setFilterHospital] = useState('');
  const [filterB2H, setFilterB2H] = useState(''); // 'B2H' or 'B2P' or ''
  const [filterProviderType, setFilterProviderType] = useState('');
  const [filterOrderStatus, setFilterOrderStatus] = useState('');
  const [filterPartnerName, setFilterPartnerName] = useState('');
  const [filterAgentEmail, setFilterAgentEmail] = useState('');
  const [filterLob, setFilterLob] = useState('');


  // Auth check on mount
  useEffect(() => {
    const token = localStorage.getItem('dash_token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetch(`/api/auth?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          localStorage.removeItem('dash_token');
          router.push('/login');
        } else {
          setUser(d);
          setLoading(false);
        }
      })
      .catch(() => {
        localStorage.removeItem('dash_token');
        router.push('/login');
      });
  }, [router]);

  // API type mapping
  const tabToApiType = {
    summary: 'coll-lob',
    city: 'coll-summary',
    hospital: 'coll-hospital',
    partner: 'coll-partner',
    employee: 'coll-employee',
    trend: 'coll-trend',
    ageing: 'coll-ageing',
    b2h: 'coll-b2h',
    raw: 'coll-raw',
  };

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    const apiType = tabToApiType[activeTab];
    const params = new URLSearchParams({
      type: apiType,
      token: localStorage.getItem('dash_token'),
      startDate,
      endDate,
      dateType,
    });
    if (activeTab === 'employee') params.append('empStatus', empStatus === 'All' ? '' : empStatus);

    try {
      const res = await fetch(`/api/data?${params}`);
      const json = await res.json();
      setData(json.data || []);
      setError(json.error ? json.error : '');
    } catch (e) {
      setError('Failed to fetch data');
      setData([]);
    } finally {
      setDataLoading(false);
    }
  }, [user, activeTab, startDate, endDate, empStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: 18 }}>
        Loading...
      </div>
    );
  }

  if (!user) return null;


  // Indian number format with commas (12,34,567)
  const fmtIndian = (n) => {
    const num = Math.round(Math.abs(n));
    const s = num.toString();
    if (s.length <= 3) return (n < 0 ? '-' : '') + s;
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    return (n < 0 ? '-' : '') + formatted;
  };

  const fmtAmt = (v) => {
    const n = Number(v);
    if (isNaN(n)) return v;
    const abs = Math.abs(n);
    if (abs >= 100000) return (n / 100000).toFixed(2) + ' L';
    return fmtIndian(n);
  };

  const formatCell = (colName, value) => {
    if (value === null || value === undefined) return '';
    const upper = colName.toUpperCase();
    if (['REVENUE', 'MARGIN', 'BANK', 'PENDING', 'COLLECT', 'COST', 'CASH', 'B2H'].some(k => upper.includes(k))) {
      return fmtAmt(value);
    }
    if (upper.includes('PCT') || upper.includes('EFFICIENCY')) {
      const num = Number(value);
      return isNaN(num) ? value : num.toFixed(1) + '%';
    }
    if (upper.includes('DATE') && value) {
      // Format dates as DD-MMM-YYYY
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
        }
      } catch(e) {}
    }
    return value.toString();
  };

  const getCellColor = (colName, value) => {
    const upper = colName.toUpperCase();
    if (upper.includes('EFFICIENCY') || upper.includes('PCT')) {
      const num = Number(value);
      if (num >= 80) return '#16a34a';
      if (num >= 50) return '#ea8c00';
      return '#dc2626';
    }
    if (upper.includes('RISK') || upper.includes('TAG')) {
      const v = String(value).toLowerCase();
      if (v === 'normal') return '#16a34a';
      if (v === 'high') return '#ea8c00';
      if (v === 'critical') return '#ff8c00';
      if (v === 'red alert') return '#dc2626';
      if (v === 'severe') return '#8b0000';
    }
    if (upper.includes('STATUS')) {
      const v = String(value).toUpperCase();
      return v === 'ACTIVE' ? '#16a34a' : '#dc2626';
    }
    if (upper.includes('PENDING')) {
      const num = Number(value);
      if (num > 0) return '#dc2626';
      if (num < 0) return '#16a34a';
    }
    return '#000';
  };

  const getCols = () => {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  };

  const computeColTotal = (colName) => {
    if (filteredData.length === 0) return '';
    const upper = colName.toUpperCase();
    if (upper.includes('EFFICIENCY') || upper.includes('PCT')) {
      const bankCol = getCols().find(c => c.toUpperCase() === 'TOTAL_RECEIVED_IN_BANK');
      const marginCol = getCols().find(c => c.toUpperCase() === 'TOTAL_RED_MARGIN');
      if (bankCol && marginCol) {
        const totalBank = filteredData.reduce((acc, row) => acc + (Number(row[bankCol]) || 0), 0);
        const totalMargin = filteredData.reduce((acc, row) => acc + (Number(row[marginCol]) || 0), 0);
        const eff = totalMargin > 0 ? (100 * totalBank / totalMargin) : 0;
        return eff.toFixed(1) + '%';
      }
      return '';
    }
    if (upper.includes('TAT') || upper.includes('AVG')) {
      const avg = filteredData.reduce((acc, row) => acc + (Number(row[colName]) || 0), 0) / filteredData.length;
      return Math.round(avg).toString();
    }
    const isNumeric = ['REVENUE', 'MARGIN', 'BANK', 'PENDING', 'COLLECT', 'COST', 'CASH', 'B2H', 'COUNT', 'ORDERS'].some(k => upper.includes(k));
    if (!isNumeric) return '';
    const sum = filteredData.reduce((acc, row) => acc + (Number(row[colName]) || 0), 0);
    return formatCell(colName, sum);
  };

  const getKpiCards = () => {
    if (!['summary', 'city'].includes(activeTab) || filteredData.length === 0) return [];
    const kpis = [
      { label: 'Total Orders', key: 'TOTAL_ORDERS', color: '#3b82f6' },
      { label: 'Total Revenue', key: 'TOTAL_REVENUE', color: '#3b82f6' },
      { label: 'Total RED Margin', key: 'TOTAL_RED_MARGIN', color: '#16a34a' },
      { label: 'Received in Bank (All-Time)', key: 'TOTAL_RECEIVED_IN_BANK', color: '#16a34a' },
      { label: 'At Bank (This Period)', key: 'TOTAL_AT_BANK_IN_PERIOD', color: '#059669' },
      { label: 'Pending Employee', key: 'TOTAL_PENDING_EMPLOYEE', color: '#ea8c00' },
      { label: 'Pending Partner', key: 'TOTAL_PENDING_PARTNER', color: '#ea8c00' },
      { label: 'Pending Collection', key: 'PENDING_COLLECTION', color: '#dc2626' },
      { label: 'Collection Efficiency %', key: 'COLLECTION_EFFICIENCY_PCT', color: '#16a34a' },
    ];

    return kpis
      .map(kpi => {
        const col = getCols().find(c => c.toUpperCase() === kpi.key);
        if (!col) return null;
        if (kpi.key === 'COLLECTION_EFFICIENCY_PCT') {
          const bankCol = getCols().find(c => c.toUpperCase() === 'TOTAL_RECEIVED_IN_BANK');
          const marginCol = getCols().find(c => c.toUpperCase() === 'TOTAL_RED_MARGIN');
          const totalBank = filteredData.reduce((acc, row) => acc + (Number(row[bankCol]) || 0), 0);
          const totalMargin = filteredData.reduce((acc, row) => acc + (Number(row[marginCol]) || 0), 0);
          const eff = totalMargin > 0 ? (100 * totalBank / totalMargin) : 0;
          const color = eff >= 80 ? '#16a34a' : eff >= 50 ? '#ea8c00' : '#dc2626';
          return { label: kpi.label, value: eff.toFixed(1) + '%', color };
        }
        if (kpi.key === 'PENDING_COLLECTION') {
          const sum = filteredData.reduce((acc, row) => acc + (Number(row[col]) || 0), 0);
          const color = sum <= 0 ? '#16a34a' : '#dc2626';
          return { label: kpi.label, value: fmtAmt(sum), color };
        }
        const sum = filteredData.reduce((acc, row) => acc + (Number(row[col]) || 0), 0);
        return { label: kpi.label, value: fmtAmt(sum), color: kpi.color };
      })
      .filter(Boolean);
  };

  const getAgeingCards = () => {
    if (activeTab !== 'ageing' || data.length === 0) return [];
    const riskCounts = { Normal: 0, High: 0, Critical: 0, 'Red Alert': 0, Severe: 0 };
    data.forEach(row => {
      const risk = row.RISK_TAG || '';
      if (riskCounts.hasOwnProperty(risk)) riskCounts[risk]++;
    });
    return Object.entries(riskCounts).map(([tag, count]) => ({ tag, count }));
  };

  // ── Pre-compute column key lookups (avoids Object.keys().find() per row per filter) ──
  const _buildColKeyMap = () => {
    if (data.length === 0) return {};
    const keys = Object.keys(data[0]);
    const map = {};
    ['CITY', 'HOSPITAL_NAME', 'LOB', 'PROVIDER_TYPE', 'ORDER_STATUS', 'PARTNER_NAME', 'AGENT_EMAIL', 'EMPLOYEE_EMAIL', 'B2H'].forEach(t => {
      map[t] = keys.find(k => k.toUpperCase() === t) || null;
    });
    return map;
  };
  const colKeyMap = _buildColKeyMap();

  // All active filters
  const allFilters = {
    city: { col: 'CITY', val: filterCity },
    hospital: { col: 'HOSPITAL_NAME', val: filterHospital },
    lob: { col: 'LOB', val: filterLob },
    providerType: { col: 'PROVIDER_TYPE', val: filterProviderType },
    orderStatus: { col: 'ORDER_STATUS', val: filterOrderStatus },
    partnerName: { col: 'PARTNER_NAME', val: filterPartnerName },
    agentEmail: { col: 'AGENT_EMAIL', val: filterAgentEmail },
    b2h: { col: 'B2H', val: filterB2H },
  };

  // Fast row matcher using pre-computed column keys
  const rowMatchesFilter = (row, filterKey) => {
    const f = allFilters[filterKey];
    if (!f.val) return true;
    if (filterKey === 'agentEmail') {
      const k = colKeyMap['AGENT_EMAIL'] || colKeyMap['EMPLOYEE_EMAIL'];
      if (!k) return true;
      return String(row[k]).trim() === f.val;
    }
    const k = colKeyMap[f.col];
    if (!k) return true;
    return String(row[k]).trim() === f.val;
  };

  // Filter data applying ALL filters EXCEPT the excluded one (for cascading dropdowns)
  const filterDataExcluding = (excludeKey) => {
    const filterKeys = Object.keys(allFilters);
    return data.filter(row => {
      for (const fk of filterKeys) {
        if (fk === excludeKey) continue;
        if (!rowMatchesFilter(row, fk)) return false;
      }
      if (activeTab === 'ageing' && ageingFilter && row.RISK_TAG !== ageingFilter) return false;
      return true;
    });
  };

  // Get unique sorted values using pre-computed key map
  const uniqueVals = (dataset, colKey) => {
    const key = colKeyMap[colKey];
    if (!key) return [];
    const vals = new Set();
    for (let i = 0; i < dataset.length; i++) {
      const v = dataset[i][key];
      if (v !== null && v !== undefined && String(v).trim() !== '') vals.add(String(v).trim());
    }
    return [...vals].sort();
  };

  // Interconnected options
  const optionsCity = uniqueVals(filterDataExcluding('city'), 'CITY');
  const optionsHospital = uniqueVals(filterDataExcluding('hospital'), 'HOSPITAL_NAME');
  const optionsLob = uniqueVals(filterDataExcluding('lob'), 'LOB');
  const optionsProviderType = uniqueVals(filterDataExcluding('providerType'), 'PROVIDER_TYPE');
  const optionsOrderStatus = uniqueVals(filterDataExcluding('orderStatus'), 'ORDER_STATUS');
  const optionsPartnerName = uniqueVals(filterDataExcluding('partnerName'), 'PARTNER_NAME');
  const optionsAgentEmail = uniqueVals(filterDataExcluding('agentEmail'), 'AGENT_EMAIL').length > 0
    ? uniqueVals(filterDataExcluding('agentEmail'), 'AGENT_EMAIL')
    : uniqueVals(filterDataExcluding('agentEmail'), 'EMPLOYEE_EMAIL');

  // Final filtered data (all filters applied)
  const filteredData = data.filter(row => {
    for (const fk of Object.keys(allFilters)) {
      if (!rowMatchesFilter(row, fk)) return false;
    }
    if (activeTab === 'ageing' && ageingFilter && row.RISK_TAG !== ageingFilter) return false;
    // Employee active/inactive filter
    if (activeTab === 'employee' && empStatus !== 'All') {
      const status = String(row.EMPLOYEE_STATUS || '').toUpperCase();
      if (empStatus === 'Active Only' && status !== 'ACTIVE') return false;
      if (empStatus === 'Inactive Only' && (status === 'ACTIVE' || status === '')) return false;
    }
    return true;
  });

  const cols = getCols();

  // Reset all client-side filters
  const resetFilters = () => {
    setFilterCity(''); setFilterHospital(''); setFilterB2H('');
    setFilterProviderType(''); setFilterOrderStatus('');
    setFilterPartnerName(''); setFilterAgentEmail(''); setFilterLob('');
  };


  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: '#c0392b', color: '#fff', padding: '16px 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Collections & Payments Dashboard</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 14 }}>
              {user.name} · {user.role}
            </div>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.5)',
                color: '#fff',
                padding: '6px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
        {/* Filter Bar */}
        <div style={{ background: '#fff', borderRadius: 10, padding: '16px', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}
              />
            </div>

            <button
              onClick={fetchData}
              style={{
                marginTop: 20,
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                padding: '6px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Refresh
            </button>
          </div>

          {/* Row 2: Client-side filters */}
          {data.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
              {/* City */}
              {optionsCity.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>City</label>
                  <select value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 100 }}>
                    <option value="">All</option>
                    {optionsCity.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Hospital */}
              {optionsHospital.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Hospital</label>
                  <select value={filterHospital} onChange={e => setFilterHospital(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 120 }}>
                    <option value="">All</option>
                    {optionsHospital.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* LOB */}
              {optionsLob.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>LOB</label>
                  <select value={filterLob} onChange={e => setFilterLob(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 100 }}>
                    <option value="">All</option>
                    {optionsLob.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* B2H / B2P */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>B2H / B2P</label>
                <select value={filterB2H} onChange={e => setFilterB2H(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 80 }}>
                  <option value="">All</option>
                  <option value="B2H">B2H</option>
                  <option value="B2P">B2P</option>
                </select>
              </div>

              {/* Provider Type */}
              {optionsProviderType.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Provider Type</label>
                  <select value={filterProviderType} onChange={e => setFilterProviderType(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 100 }}>
                    <option value="">All</option>
                    {optionsProviderType.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Order Status */}
              {optionsOrderStatus.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Order Status</label>
                  <select value={filterOrderStatus} onChange={e => setFilterOrderStatus(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 110 }}>
                    <option value="">All</option>
                    {optionsOrderStatus.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Partner Name */}
              {optionsPartnerName.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Partner</label>
                  <select value={filterPartnerName} onChange={e => setFilterPartnerName(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 120 }}>
                    <option value="">All</option>
                    {optionsPartnerName.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Agent Email */}
              {optionsAgentEmail.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Agent Email</label>
                  <select value={filterAgentEmail} onChange={e => setFilterAgentEmail(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: 12, minWidth: 150 }}>
                    <option value="">All</option>
                    {optionsAgentEmail.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              )}

              {/* Clear All Filters */}
              <button
                onClick={resetFilters}
                style={{ marginTop: 14, background: 'none', border: '1px solid #ddd', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#666', fontWeight: 600 }}
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        {getKpiCards().length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {getKpiCards().map((kpi, idx) => (
              <div
                key={idx}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: '16px 20px',
                  minWidth: 160,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  borderLeft: `4px solid ${kpi.color}`,
                }}
              >
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, borderBottom: '1px solid #e5e7eb', overflowX: 'auto' }}>
          {[
            { id: 'summary', label: 'LOB Summary' },
            { id: 'city', label: 'City Summary' },
            { id: 'hospital', label: 'Hospital' },
            { id: 'partner', label: 'Partner' },
            { id: 'employee', label: 'Employee' },
            { id: 'trend', label: 'Trends' },
            { id: 'ageing', label: 'Ageing Detail' },
            { id: 'b2h', label: 'B2H Summary' },
            { id: 'raw', label: 'Raw Report' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setAgeingFilter(null);
              }}
              style={{
                background: activeTab === tab.id ? '#3b82f6' : 'transparent',
                color: activeTab === tab.id ? '#fff' : '#666',
                border: 'none',
                padding: '10px 14px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 600 : 500,
                borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Employee Tab Filter */}
        {activeTab === 'employee' && (
          <div style={{ marginBottom: 16 }}>
            <select
              value={empStatus}
              onChange={(e) => setEmpStatus(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #ddd', fontSize: 13 }}
            >
              <option>All</option>
              <option>Active Only</option>
              <option>Inactive Only</option>
            </select>
          </div>
        )}

        {/* Ageing Risk Filter Cards */}
        {activeTab === 'ageing' && getAgeingCards().length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {getAgeingCards().map(({ tag, count }, idx) => (
              <button
                key={idx}
                onClick={() => setAgeingFilter(tag)}
                style={{
                  background: ageingFilter === tag ? '#3b82f6' : '#fff',
                  color: ageingFilter === tag ? '#fff' : '#000',
                  border: '1px solid #ddd',
                  padding: '8px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {tag}: {count}
              </button>
            ))}
            {ageingFilter && (
              <button
                onClick={() => setAgeingFilter(null)}
                style={{
                  background: '#fff',
                  color: '#666',
                  border: '1px solid #ddd',
                  padding: '8px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Show All
              </button>
            )}
          </div>
        )}

        {/* Data Table */}
        {error && <div style={{ color: '#dc2626', marginBottom: 16 }}>{error}</div>}
        {dataLoading && <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading...</div>}
        {!dataLoading && filteredData.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>No collection data found</div>
        )}
        {!dataLoading && filteredData.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff' }}>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th
                      key={c}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderBottom: '2px solid #e5e7eb',
                        color: '#475569',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                        textTransform: 'uppercase',
                        position: 'sticky',
                        top: 0,
                        background: '#fff',
                        zIndex: 10,
                      }}
                    >
                      {c.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
                <tr style={{ background: '#eff6ff', fontWeight: 700 }}>
                  {cols.map((c, idx) => (
                    <td
                      key={c}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '2px solid #3b82f6',
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        top: 38,
                        background: '#eff6ff',
                        zIndex: 9,
                      }}
                    >
                      {idx === 0 ? 'TOTAL' : computeColTotal(c)}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, ridx) => (
                  <tr key={ridx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    {cols.map(c => (
                      <td
                        key={c}
                        style={{
                          padding: '8px 12px',
                          whiteSpace: 'nowrap',
                          color: getCellColor(c, row[c]),
                        }}
                      >
                        {formatCell(c, row[c])}
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
