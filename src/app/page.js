'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ZONE_CITY_MAP, CITY_NAMES, TARGETS } from '@/lib/constants';

// --- Helpers ---
const fmt = (n) => n != null ? Number(n).toLocaleString('en-IN') : '\u2014';
const fmtL = (n) => n != null ? '\u20B9' + Number(n).toFixed(2) + 'L' : '\u2014';
const fmtR = (n) => n != null ? '\u20B9' + fmt(n) : '\u2014';
const pct = (n) => n != null ? Number(n).toFixed(1) + '%' : '\u2014';
const arrow = (curr, prev) => {
  if (curr == null || prev == null) return { icon: '\u2192', color: 'text-gray-400' };
  const c = Number(curr), p = Number(prev);
  if (c > p) return { icon: '\u2191', color: 'text-green-700' };
  if (c < p) return { icon: '\u2193', color: 'text-red-600' };
  return { icon: '\u2192', color: 'text-gray-400' };
};
const statusColor = (val, target, higherIsBetter = true) => {
  if (val == null) return 'text-gray-400';
  const v = Number(val);
  if (higherIsBetter) return v >= target ? 'text-green-700 font-semibold' : 'text-red-600 font-semibold';
  return v <= target ? 'text-green-700 font-semibold' : 'text-red-600 font-semibold';
};

// Performance tier: returns { label, bg, text, border } for good/average/below average
function perfTier(bookings, convPct, cancelPct) {
  let score = 0;
  const b = Number(bookings) || 0;
  const conv = Number(convPct) || 0;
  const cancel = Number(cancelPct) || 0;
  // Booking volume
  if (b >= 50) score += 2; else if (b >= 20) score += 1;
  // Conversion
  if (conv >= 60) score += 2; else if (conv >= 40) score += 1;
  // Cancel (lower is better)
  if (cancel <= 10) score += 2; else if (cancel <= 15) score += 1;

  if (score >= 5) return { label: 'Good', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' };
  if (score >= 3) return { label: 'Average', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' };
  return { label: 'Below Avg', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' };
}

// --- Date helpers ---
function getISTToday() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}
function getISTMonthStart() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-01`;
}
function getISTYesterday() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setDate(ist.getDate() - 1);
  return ist.toISOString().split('T')[0];
}

// --- Main Page ---
export default function Dashboard() {
  const router = useRouter();
  const [zone, setZone] = useState('All');
  const [selectedLobs, setSelectedLobs] = useState([]);
  const [selectedCities, setSelectedCities] = useState([]);
  const [activeTab, setActiveTab] = useState('city'); // city | hospital | agent
  const [funnel, setFunnel] = useState(null);
  const [finance, setFinance] = useState(null);
  const [hospitals, setHospitals] = useState(null);
  const [hospitalFin, setHospitalFin] = useState(null);
  const [agents, setAgents] = useState(null);
  const [agentFin, setAgentFin] = useState(null);
  const [dates, setDates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Date filter state
  const [customStart, setCustomStart] = useState(getISTMonthStart());
  const [customEnd, setCustomEnd] = useState(getISTToday());
  const [isCustomRange, setIsCustomRange] = useState(false);

  // Auth state
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionToken, setSessionToken] = useState('');

  // Auth check on mount
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('dash_token') : null;
    if (!token) { router.push('/login'); return; }
    setSessionToken(token);
    fetch('/api/auth?token=' + token)
      .then(r => r.json())
      .then(d => {
        if (!d.authenticated) { localStorage.removeItem('dash_token'); router.push('/login'); return; }
        setAuthUser(d.user);
        setAuthChecked(true);
      })
      .catch(() => { router.push('/login'); });
  }, [router]);

  // User/role filter state (from auth, replaces old roles.js)
  const currentUser = authUser;

  const zones = ['All', ...Object.keys(ZONE_CITY_MAP)];

  const visibleCities = useMemo(() => {
    let cities = zone === 'All' ? Object.values(ZONE_CITY_MAP).flat() : (ZONE_CITY_MAP[zone] || []);
    // If user has role-based restriction, intersect with their allowed cities
    if (currentUser && currentUser.allowedCities) {
      const allowed = new Set(currentUser.allowedCities.map(c => c.toUpperCase()));
      cities = cities.filter(c => allowed.has(c.toUpperCase()));
    }
    return cities;
  }, [zone, currentUser]);

  // Build query string for date params
  const dateQueryString = useMemo(() => {
    if (!isCustomRange) return '';
    const params = new URLSearchParams();
    params.set('start', customStart);
    params.set('end', customEnd);
    const endDate = new Date(customEnd + 'T00:00:00');
    const yday = new Date(endDate);
    yday.setDate(yday.getDate() - 1);
    params.set('today', customEnd);
    params.set('yesterday', yday.toISOString().split('T')[0]);
    return '?' + params.toString();
  }, [isCustomRange, customStart, customEnd]);

  // Fetch data via proxy endpoint
  const fetchData = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    try {
      const qs = dateQueryString;
      const sep = qs ? '&' : '?';
      const base = qs ? '/api/data' + qs + '&' : '/api/data?';
      const hdrs = { 'x-session-token': sessionToken };
      const [fRes, finRes, hospRes, agentRes, hospFinRes, agentFinRes] = await Promise.all([
        fetch(base + 'type=funnel', { headers: hdrs }),
        fetch(base + 'type=finance', { headers: hdrs }),
        fetch(base + 'type=hospital', { headers: hdrs }),
        fetch(base + 'type=agent', { headers: hdrs }),
        fetch(base + 'type=hospital-finance', { headers: hdrs }),
        fetch(base + 'type=agent-finance', { headers: hdrs }),
      ]);
      // If any return 401, redirect to login
      if (fRes.status === 401 || finRes.status === 401) {
        localStorage.removeItem('dash_token');
        router.push('/login');
        return;
      }
      if (!fRes.ok || !finRes.ok) throw new Error('API request failed');
      const fData = await fRes.json();
      const finData = await finRes.json();
      const hospData = hospRes.ok ? await hospRes.json() : { data: [] };
      const agentData = agentRes.ok ? await agentRes.json() : { data: [] };
      const hospFinData = hospFinRes.ok ? await hospFinRes.json() : { data: [] };
      const agentFinData = agentFinRes.ok ? await agentFinRes.json() : { data: [] };
      setFunnel(fData.data);
      setFinance(finData.data);
      setHospitals(hospData.data || []);
      setHospitalFin(hospFinData.data || []);
      setAgents(agentData.data || []);
      setAgentFin(agentFinData.data || []);
      setDates(fData.dates);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dateQueryString, sessionToken, router]);

  useEffect(() => { if (authChecked && sessionToken) fetchData(); }, [fetchData, authChecked, sessionToken]);

  // Log dashboard access
  useEffect(() => {
    if (!loading && funnel && currentUser) {
      const cities = currentUser.allowedCities ? currentUser.allowedCities.join(',') : 'ALL';
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: currentUser.email,
          userName: currentUser.name,
          userRole: currentUser.role,
          action: 'page_load',
          citiesViewed: cities
        })
      }).catch(() => {});
    }
  }, [loading, funnel, currentUser]);

  // Merge funnel + finance by city, filter by zone
  const cityData = useMemo(() => {
    if (!funnel || !finance) return [];
    const finMap = {};
    finance.forEach(r => { finMap[`${r.CITY}||${r.LOB}`] = r; });

    return funnel
      .filter(f => visibleCities.includes(f.CITY) || f.CITY === 'DIGITAL')
      .filter(f => selectedCities.length === 0 || selectedCities.includes(f.CITY))
      .filter(f => selectedLobs.length === 0 || selectedLobs.includes(f.LOB || ''))
      .map(f => ({
        ...f,
        fin: finMap[`${f.CITY}||${f.LOB}`] || {},
        cityName: CITY_NAMES[f.CITY] || f.CITY,
        zone: f.CITY === 'DIGITAL' ? 'Digital' : (Object.entries(ZONE_CITY_MAP).find(([, cities]) => cities.includes(f.CITY))?.[0] || '\u2014'),
      }));
  }, [funnel, finance, visibleCities, selectedCities, selectedLobs]);

  // Filtered hospital data with finance merge
  const hospitalData = useMemo(() => {
    if (!hospitals) return [];
    const finMap = {};
    (hospitalFin || []).forEach(r => {
      const key = `${r.CITY}||${r.HOSPITAL}||${r.LOB}`;
      finMap[key] = r;
    });
    return hospitals
      .filter(h => visibleCities.includes(h.CITY) || h.CITY === 'DIGITAL')
      .filter(h => selectedCities.length === 0 || selectedCities.includes(h.CITY))
      .filter(h => selectedLobs.length === 0 || selectedLobs.includes(h.LOB || ''))
      .map(h => ({ ...h, fin: finMap[`${h.CITY}||${h.HOSPITAL}||${h.LOB}`] || {} }));
  }, [hospitals, hospitalFin, visibleCities, selectedCities, selectedLobs]);

  // Filtered agent data with finance merge
  const agentData = useMemo(() => {
    if (!agents) return [];
    const finMap = {};
    (agentFin || []).forEach(r => {
      const key = `${r.CITY}||${r.AGENT}||${r.LOB}`;
      finMap[key] = r;
    });
    return agents
      .filter(a => visibleCities.includes(a.CITY) || a.CITY === 'DIGITAL')
      .filter(a => selectedCities.length === 0 || selectedCities.includes(a.CITY))
      .filter(a => selectedLobs.length === 0 || selectedLobs.includes(a.LOB || ''))
      .map(a => ({ ...a, fin: finMap[`${a.CITY}||${a.AGENT}||${a.LOB}`] || {} }));
  }, [agents, agentFin, visibleCities, selectedCities, selectedLobs]);

  // Aggregated totals
  const totals = useMemo(() => {
    if (!cityData.length) return null;
    const sum = (key) => cityData.reduce((s, c) => s + (Number(c[key]) || 0), 0);
    const sumFin = (key) => cityData.reduce((s, c) => s + (Number(c.fin?.[key]) || 0), 0);
    const totalRev = sumFin('MTD_REV');
    const totalNonOwnRev = sumFin('MTD_NON_OWN_REV');
    const totalMarginAmt = sumFin('MTD_MARGIN_AMT');
    const totalDqr = sumFin('MTD_DQR');
    const totalOwnRoad = sumFin('MTD_OWN_ROAD_REV');
    const totalRoadRev = sumFin('MTD_ROAD_REV');
    return {
      enquiry: sum('MTD_ENQUIRY'), booking: sum('MTD_BOOKING'),
      tripComp: sum('MTD_TRIP_COMP'), revL: sum('MTD_REV_BKD_L'), canL: sum('MTD_REV_CAN_L'),
      finRev: totalRev,
      marginPct: totalNonOwnRev > 0 ? (totalMarginAmt / totalNonOwnRev * 100).toFixed(1) : null,
      dqrPct: totalRev > 0 ? (totalDqr / totalRev * 100).toFixed(1) : null,
      ownRoadPct: totalRoadRev > 0 ? (totalOwnRoad / totalRoadRev * 100).toFixed(1) : null,
      todayTrips: sumFin('TODAY_TRIPS'), todayRev: sumFin('TODAY_REV'),
      ydayTrips: sumFin('YDAY_TRIPS'), ydayRev: sumFin('YDAY_REV'),
    };
  }, [cityData]);

  const toggleCity = (code) => {
    setSelectedCities(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const tabs = [
    { id: 'city', label: 'City View' },
    { id: 'hospital', label: 'Hospital Summary' },
    { id: 'agent', label: 'Agent Summary' },
  ];

  // --- Auth loading screen ---
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 bg-red-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-xl font-bold">R</span>
          </div>
          <p className="text-gray-500 text-sm">Authenticating...</p>
        </div>
      </div>
    );
  }

  // --- Render ---
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">RED.Health City Performance</h1>
              <p className="text-red-100 text-sm mt-1">
                {dates ? `${dates.mtdStart} \u2192 ${dates.mtdEnd}` : 'Loading...'}
                {isCustomRange && <span className="ml-2 px-1.5 py-0.5 bg-white/20 rounded text-xs">Custom</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Date Range Picker */}
              <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-3 py-1.5">
                <label className="text-xs text-red-100 font-medium">From</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => { setCustomStart(e.target.value); setIsCustomRange(true); }}
                  className="bg-white/20 text-white text-sm rounded px-2 py-1 border border-white/30 focus:outline-none focus:border-white/60 [color-scheme:dark]"
                />
                <label className="text-xs text-red-100 font-medium ml-1">To</label>
                <input
                  type="date"
                  value={customEnd}
                  max={getISTToday()}
                  onChange={(e) => { setCustomEnd(e.target.value); setIsCustomRange(true); }}
                  className="bg-white/20 text-white text-sm rounded px-2 py-1 border border-white/30 focus:outline-none focus:border-white/60 [color-scheme:dark]"
                />
              </div>
              {/* Quick presets */}
              <div className="flex gap-1">
                <button
                  onClick={() => { setCustomStart(getISTMonthStart()); setCustomEnd(getISTToday()); setIsCustomRange(false); }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${!isCustomRange ? 'bg-white text-red-700' : 'bg-white/20 hover:bg-white/30'}`}
                >MTD</button>
                <button
                  onClick={() => { setCustomStart(getISTYesterday()); setCustomEnd(getISTYesterday()); setIsCustomRange(true); }}
                  className="px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition"
                >Yesterday</button>
                <button
                  onClick={() => {
                    const end = new Date(getISTToday() + 'T00:00:00');
                    const start = new Date(end);
                    start.setDate(start.getDate() - 6);
                    setCustomStart(start.toISOString().split('T')[0]);
                    setCustomEnd(getISTToday());
                    setIsCustomRange(true);
                  }}
                  className="px-2.5 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition"
                >Last 7d</button>
              </div>
              {/* Auth User Info */}
              {currentUser && (
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 bg-white/20 rounded-lg text-xs font-medium">
                    {currentUser.name} ({currentUser.role.toUpperCase()})
                  </span>
                  <button onClick={() => router.push('/finance')}
                    className="px-3 py-1.5 bg-green-500/30 hover:bg-green-500/50 rounded-lg text-xs font-medium transition">
                    Finance Analytics
                  </button>
                  {currentUser.role === 'admin' && (
                    <button onClick={() => router.push('/admin')}
                      className="px-3 py-1.5 bg-yellow-500/30 hover:bg-yellow-500/50 rounded-lg text-xs font-medium transition">
                      Admin
                    </button>
                  )}
                  <button onClick={() => {
                    fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'logout', token: sessionToken }) });
                    localStorage.removeItem('dash_token');
                    localStorage.removeItem('dash_user');
                    router.push('/login');
                  }} className="px-3 py-1.5 bg-red-500/30 hover:bg-red-500/50 rounded-lg text-xs font-medium transition">
                    Logout
                  </button>
                </div>
              )}
              <button
                onClick={fetchData}
                disabled={loading}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                {loading ? '\u27F3 Loading...' : '\u27F3 Refresh'}
              </button>
            </div>
          </div>
          {/* Date basis info + legend + user badge */}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-red-200">
            <span className="px-1.5 py-0.5 bg-blue-400/30 rounded font-semibold text-white">F</span>
            <span>Funnel (by Order Created)</span>
            <span>|</span>
            <span className="px-1.5 py-0.5 bg-green-400/30 rounded font-semibold text-white">Fin</span>
            <span>Finance (by Delivery Date)</span>
            {currentUser && (
              <>
                <span>|</span>
                <span className="px-2 py-0.5 bg-yellow-400/30 rounded font-semibold text-white">
                  {currentUser.name} &mdash; {currentUser.role.toUpperCase()} ({currentUser.allowedCities ? currentUser.allowedCities.length + ' cities' : 'All'})
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Zone</label>
              <div className="flex gap-2 mt-1">
                {zones.map(z => (
                  <button
                    key={z}
                    onClick={() => { setZone(z); setSelectedCities([]); }}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition
                      ${zone === z ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {z}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-l pl-4">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">LOB</label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setSelectedLobs([])}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition
                    ${selectedLobs.length === 0 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  All
                </button>
                {['Hospital', 'Stan Command', 'Digital'].map(lob => (
                  <button
                    key={lob}
                    onClick={() => setSelectedLobs(prev =>
                      prev.includes(lob) ? prev.filter(l => l !== lob) : [...prev, lob]
                    )}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition
                      ${selectedLobs.includes(lob) ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {lob}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-l pl-4">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cities</label>
              <div className="flex flex-wrap gap-1.5 mt-1 max-w-2xl">
                {visibleCities.map(code => (
                  <button
                    key={code}
                    onClick={() => toggleCity(code)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition
                      ${selectedCities.includes(code)
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border'}`}
                  >
                    {code}
                  </button>
                ))}
                {selectedCities.length > 0 && (
                  <button
                    onClick={() => setSelectedCities([])}
                    className="px-2.5 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            <span className="ml-3 text-gray-500">Querying Snowflake...</span>
          </div>
        ) : (
          <>
            {/* Aggregate Summary Cards */}
            {totals && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                <SummaryCard label="MTD Bookings" value={fmt(totals.booking)} source="F" />
                <SummaryCard label="MTD Completed" value={fmt(totals.tripComp)} source="F" />
                <SummaryCard label="Revenue (Booked)" value={fmtL(totals.revL)} source="F" />
                <SummaryCard label="Finance Revenue" value={fmtR(totals.finRev)} source="Fin" />
                <SummaryCard
                  label="Margin %"
                  value={pct(totals.marginPct)}
                  color={statusColor(totals.marginPct, TARGETS.margin_pct)}
                  source="Fin"
                />
                <SummaryCard
                  label="Own Vehicle %"
                  value={pct(totals.ownRoadPct)}
                  color={statusColor(totals.ownRoadPct, TARGETS.own_vehicle_pct)}
                  source="Fin"
                />
              </div>
            )}

            {/* Today vs Yesterday Quick Compare */}
            {totals && (
              <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Today vs Yesterday</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <CompareCell
                    label="Trips Delivered"
                    curr={totals.todayTrips} prev={totals.ydayTrips}
                    source="Fin"
                  />
                  <CompareCell
                    label="Revenue"
                    curr={totals.todayRev} prev={totals.ydayRev}
                    formatter={fmtR}
                    source="Fin"
                  />
                  <CompareCell
                    label="DQR %"
                    curr={totals.dqrPct} prev={null}
                    formatter={pct} single
                    color={statusColor(totals.dqrPct, TARGETS.dqr_pct)}
                    source="Fin"
                  />
                  <CompareCell
                    label="Cancel %"
                    curr={totals.revL > 0 ? (totals.canL / totals.revL * 100).toFixed(1) : null}
                    prev={null}
                    formatter={pct} single
                    color={statusColor(totals.revL > 0 ? (totals.canL / totals.revL * 100) : null, 12, false)}
                    source="F"
                  />
                </div>
              </div>
            )}

            {/* Tab Navigation */}
            <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm border p-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition
                    ${activeTab === t.id
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* City View Tab */}
            {activeTab === 'city' && (
              <div className="space-y-4">
                {cityData.map(city => (
                  <CityRow key={city.CITY} city={city} />
                ))}
                {cityData.length === 0 && (
                  <div className="text-center py-12 text-gray-400">No data for selected filters</div>
                )}
              </div>
            )}

            {/* Hospital Summary Tab */}
            {activeTab === 'hospital' && (
              <HospitalSummary data={hospitalData} />
            )}

            {/* Agent Summary Tab */}
            {activeTab === 'agent' && (
              <AgentSummary data={agentData} />
            )}
          </>
        )}
      </main>

      <footer className="text-center py-6 text-xs text-gray-400">
        RED.Health City Dashboard | Data: BLADE.CORE (Snowflake) | Excludes Digital LOC
      </footer>
    </div>
  );
}

// --- Components ---

function SummaryCard({ label, value, color = 'text-gray-900', source = '' }) {
  const srcColor = source === 'F' ? 'bg-blue-100 text-blue-700' : source === 'Fin' ? 'bg-green-100 text-green-700' : '';
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</span>
        {source && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${srcColor}`}>{source}</span>}
      </div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function CompareCell({ label, curr, prev, formatter = fmt, single = false, color = '', source = '' }) {
  const a = arrow(curr, prev);
  const srcColor = source === 'F' ? 'bg-blue-100 text-blue-700' : source === 'Fin' ? 'bg-green-100 text-green-700' : '';
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        {source && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${srcColor}`}>{source}</span>}
      </div>
      {single ? (
        <div className={`text-lg font-bold ${color}`}>{formatter(curr)}</div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-lg font-bold">{formatter(curr)}</span>
          <span className={`text-sm ${a.color}`}>{a.icon}</span>
          <span className="text-sm text-gray-400">vs {formatter(prev)}</span>
        </div>
      )}
    </div>
  );
}

function PerfBadge({ tier }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tier.bg} ${tier.text} border ${tier.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tier.dot}`}></span>
      {tier.label}
    </span>
  );
}

// --- Multi-select filter dropdown with search ---
function MultiSelectFilter({ label, options, selected, onChange, width = 'w-48' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = { current: null };

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (val) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition
          ${selected.length > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-red-600 text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none">{selected.length}</span>
        )}
        <span className="text-[10px] ml-0.5">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 ${width} bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 flex flex-col`}>
          <div className="p-2 border-b">
            <input
              type="text"
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-red-400"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1 p-1">
            {filteredOptions.length === 0 && <div className="px-2 py-1.5 text-xs text-gray-400">No matches</div>}
            {filteredOptions.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t">
              <button onClick={() => { onChange([]); setSearch(''); }} className="w-full text-xs text-red-600 hover:text-red-700 font-medium">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(''); }} />}
    </div>
  );
}

// --- Hospital Summary ---

function HospitalSummary({ data }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [filterTier, setFilterTier] = useState('all');
  const [filterHospitals, setFilterHospitals] = useState([]);
  const [filterCities, setFilterCities] = useState([]);

  const processed = useMemo(() => {
    return data.map(h => ({
      ...h,
      tier: perfTier(h.MTD_BOOKING, h.MTD_BKG_CONV_PCT, h.MTD_CANCEL_PCT),
      cityName: CITY_NAMES[h.CITY] || h.CITY,
    }));
  }, [data]);

  // Unique hospital names and cities for multi-select filters
  const hospitalNames = useMemo(() => [...new Set(processed.map(h => h.HOSPITAL))].sort(), [processed]);
  const cityNames = useMemo(() => [...new Set(processed.map(h => h.cityName))].sort(), [processed]);

  const filtered = useMemo(() => {
    let items = [...processed];
    if (filterTier !== 'all') {
      items = items.filter(h => h.tier.label === filterTier);
    }
    if (filterHospitals.length > 0) {
      items = items.filter(h => filterHospitals.includes(h.HOSPITAL));
    }
    if (filterCities.length > 0) {
      items = items.filter(h => filterCities.includes(h.cityName));
    }
    items.sort((a, b) => {
      if (sortBy === 'revenue') return (Number(b.MTD_REV_BKD_L) || 0) - (Number(a.MTD_REV_BKD_L) || 0);
      if (sortBy === 'bookings') return (Number(b.MTD_BOOKING) || 0) - (Number(a.MTD_BOOKING) || 0);
      if (sortBy === 'conversion') return (Number(b.MTD_BKG_CONV_PCT) || 0) - (Number(a.MTD_BKG_CONV_PCT) || 0);
      return 0;
    });
    return items;
  }, [processed, sortBy, filterTier, filterHospitals, filterCities]);

  const tierCounts = useMemo(() => {
    const counts = { Good: 0, Average: 0, 'Below Avg': 0 };
    processed.forEach(h => { counts[h.tier.label] = (counts[h.tier.label] || 0) + 1; });
    return counts;
  }, [processed]);

  const hasActiveFilters = filterTier !== 'all' || filterHospitals.length > 0 || filterCities.length > 0;

  return (
    <div>
      {/* Tier summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Good' ? 'all' : 'Good')}>
          <div className="text-2xl font-bold text-green-700">{tierCounts.Good}</div>
          <div className="text-xs text-green-600 font-medium">Good Performance</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Average' ? 'all' : 'Average')}>
          <div className="text-2xl font-bold text-amber-700">{tierCounts.Average}</div>
          <div className="text-xs text-amber-600 font-medium">Average Performance</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Below Avg' ? 'all' : 'Below Avg')}>
          <div className="text-2xl font-bold text-red-700">{tierCounts['Below Avg']}</div>
          <div className="text-xs text-red-600 font-medium">Below Average</div>
        </div>
      </div>

      {/* Sort + Filter controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Sort by:</span>
        {['revenue', 'bookings', 'conversion'].map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition
              ${sortBy === s ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        <span className="text-xs text-gray-500 font-medium">Filter:</span>
        <MultiSelectFilter label="Hospital" options={hospitalNames} selected={filterHospitals} onChange={setFilterHospitals} width="w-64" />
        <MultiSelectFilter label="City" options={cityNames} selected={filterCities} onChange={setFilterCities} />
        {hasActiveFilters && (
          <button onClick={() => { setFilterTier('all'); setFilterHospitals([]); setFilterCities([]); }}
            className="ml-2 px-3 py-1 rounded-full text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100">
            Clear all filters
          </button>
        )}
      </div>

      {/* Hospital table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold">F</span>
            <span className="text-xs text-blue-700 font-medium">Funnel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-semibold">Fin</span>
            <span className="text-xs text-green-700 font-medium">Finance</span>
          </div>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider z-10 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-gray-50 z-20">Hospital</th>
                <th className="px-3 py-3">City</th>
                <th className="px-3 py-3 text-right border-l border-blue-200 bg-blue-50/50">Enq <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Bkg <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Comp <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Rev Bkd <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Conv% <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Comp% <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Cancel% <span className="text-blue-500">F</span></th>
                <th className="px-2 py-3 text-right bg-blue-50/30 border-l border-blue-100" title="Today Enquiry">T.Enq</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Enq</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Bkg</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Bkg</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Comp</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Comp</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Rev</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Rev</th>
                <th className="px-3 py-3 text-right border-l border-green-200 bg-green-50/50">Trips <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Fin Rev <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Margin% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">DQR% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Own% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Road Rev <span className="text-green-600">Fin</span></th>
                <th className="px-2 py-3 text-right bg-green-50/30 border-l border-green-100">T.Trips</th>
                <th className="px-2 py-3 text-right bg-green-50/30">Y.Trips</th>
                <th className="px-2 py-3 text-right bg-green-50/30">T.FinRev</th>
                <th className="px-2 py-3 text-right bg-green-50/30">Y.FinRev</th>
                <th className="px-3 py-3 text-center">Perf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h, i) => {
                const bkgArr = arrow(h.TODAY_BOOKING, h.YDAY_BOOKING);
                const hf = h.fin || {};
                return (
                  <tr key={`${h.CITY}-${h.HOSPITAL}-${i}`} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate sticky left-0 bg-inherit" title={h.HOSPITAL}>{h.HOSPITAL}</td>
                    <td className="px-3 py-2.5 text-gray-600">{h.cityName}</td>
                    <td className="px-3 py-2.5 text-right border-l border-blue-100">{fmt(h.MTD_ENQUIRY)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(h.MTD_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(h.MTD_TRIP_COMP)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtL(h.MTD_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(h.MTD_BKG_CONV_PCT, 50)}>{pct(h.MTD_BKG_CONV_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{pct(h.MTD_TRIP_COMP_PCT)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(h.MTD_CANCEL_PCT, 12, false)}>{pct(h.MTD_CANCEL_PCT)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs border-l border-blue-100">{fmt(h.TODAY_ENQUIRY)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(h.YDAY_ENQUIRY)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmt(h.TODAY_BOOKING)} <span className={`${bkgArr.color} text-[10px]`}>{bkgArr.icon}</span></td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(h.YDAY_BOOKING)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmt(h.TODAY_TRIP_COMP)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(h.YDAY_TRIP_COMP)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmtL(h.TODAY_REV_BKD_L)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmtL(h.YDAY_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right border-l border-green-100">{fmt(hf.MTD_TRIPS_DELIVERED)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtR(hf.MTD_REV)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(hf.MTD_MARGIN_PCT, TARGETS.margin_pct)}>{pct(hf.MTD_MARGIN_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(hf.MTD_DQR_PCT, TARGETS.dqr_pct)}>{pct(hf.MTD_DQR_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(hf.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}>{pct(hf.MTD_OWN_ROAD_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtR(hf.MTD_ROAD_REV)}</td>
                    <td className="px-2 py-2.5 text-right text-xs border-l border-green-100">{fmt(hf.TODAY_TRIPS)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(hf.YDAY_TRIPS)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmtR(hf.TODAY_REV)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmtR(hf.YDAY_REV)}</td>
                    <td className="px-3 py-2.5 text-center"><PerfBadge tier={h.tier} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400">No hospitals for selected filters</div>
        )}
        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 border-t">
          Showing {filtered.length} of {processed.length} hospitals
        </div>
      </div>
    </div>
  );
}

// --- Agent Summary ---

function AgentSummary({ data }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [filterTier, setFilterTier] = useState('all');
  const [filterAgents, setFilterAgents] = useState([]);
  const [filterCities, setFilterCities] = useState([]);
  const [filterLOBs, setFilterLOBs] = useState([]);

  const processed = useMemo(() => {
    return data.map(a => ({
      ...a,
      tier: perfTier(a.MTD_BOOKING, a.MTD_BKG_CONV_PCT, a.MTD_CANCEL_PCT),
      cityName: CITY_NAMES[a.CITY] || a.CITY,
      agentShort: (a.AGENT || '').split('@')[0] || 'Unknown',
    }));
  }, [data]);

  // Unique values for multi-select filters
  const agentNames = useMemo(() => [...new Set(processed.map(a => a.agentShort))].sort(), [processed]);
  const cityNames = useMemo(() => [...new Set(processed.map(a => a.cityName))].sort(), [processed]);
  const lobNames = useMemo(() => [...new Set(processed.map(a => a.LOB).filter(Boolean))].sort(), [processed]);

  const filtered = useMemo(() => {
    let items = [...processed];
    if (filterTier !== 'all') {
      items = items.filter(a => a.tier.label === filterTier);
    }
    if (filterAgents.length > 0) {
      items = items.filter(a => filterAgents.includes(a.agentShort));
    }
    if (filterCities.length > 0) {
      items = items.filter(a => filterCities.includes(a.cityName));
    }
    if (filterLOBs.length > 0) {
      items = items.filter(a => filterLOBs.includes(a.LOB));
    }
    items.sort((a, b) => {
      if (sortBy === 'revenue') return (Number(b.MTD_REV_BKD_L) || 0) - (Number(a.MTD_REV_BKD_L) || 0);
      if (sortBy === 'bookings') return (Number(b.MTD_BOOKING) || 0) - (Number(a.MTD_BOOKING) || 0);
      if (sortBy === 'conversion') return (Number(b.MTD_BKG_CONV_PCT) || 0) - (Number(a.MTD_BKG_CONV_PCT) || 0);
      return 0;
    });
    return items;
  }, [processed, sortBy, filterTier, filterAgents, filterCities, filterLOBs]);

  const tierCounts = useMemo(() => {
    const counts = { Good: 0, Average: 0, 'Below Avg': 0 };
    processed.forEach(a => { counts[a.tier.label] = (counts[a.tier.label] || 0) + 1; });
    return counts;
  }, [processed]);

  const hasActiveFilters = filterTier !== 'all' || filterAgents.length > 0 || filterCities.length > 0 || filterLOBs.length > 0;

  return (
    <div>
      {/* Tier summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Good' ? 'all' : 'Good')}>
          <div className="text-2xl font-bold text-green-700">{tierCounts.Good}</div>
          <div className="text-xs text-green-600 font-medium">Good Performance</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Average' ? 'all' : 'Average')}>
          <div className="text-2xl font-bold text-amber-700">{tierCounts.Average}</div>
          <div className="text-xs text-amber-600 font-medium">Average Performance</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition"
          onClick={() => setFilterTier(filterTier === 'Below Avg' ? 'all' : 'Below Avg')}>
          <div className="text-2xl font-bold text-red-700">{tierCounts['Below Avg']}</div>
          <div className="text-xs text-red-600 font-medium">Below Average</div>
        </div>
      </div>

      {/* Sort + Filter controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 font-medium">Sort by:</span>
        {['revenue', 'bookings', 'conversion'].map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition
              ${sortBy === s ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        <span className="text-xs text-gray-500 font-medium">Filter:</span>
        <MultiSelectFilter label="Agent" options={agentNames} selected={filterAgents} onChange={setFilterAgents} width="w-64" />
        <MultiSelectFilter label="City" options={cityNames} selected={filterCities} onChange={setFilterCities} />
        <MultiSelectFilter label="LOB" options={lobNames} selected={filterLOBs} onChange={setFilterLOBs} width="w-40" />
        {hasActiveFilters && (
          <button onClick={() => { setFilterTier('all'); setFilterAgents([]); setFilterCities([]); setFilterLOBs([]); }}
            className="ml-2 px-3 py-1 rounded-full text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100">
            Clear all filters
          </button>
        )}
      </div>

      {/* Agent table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold">F</span>
            <span className="text-xs text-blue-700 font-medium">Funnel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-semibold">Fin</span>
            <span className="text-xs text-green-700 font-medium">Finance</span>
          </div>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider z-10 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <tr>
                <th className="px-4 py-3 sticky left-0 bg-gray-50 z-20">Agent</th>
                <th className="px-3 py-3">City</th>
                <th className="px-3 py-3">LOB</th>
                <th className="px-3 py-3 text-right border-l border-blue-200 bg-blue-50/50">Enq <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Bkg <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Comp <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Rev Bkd <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Conv% <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Comp% <span className="text-blue-500">F</span></th>
                <th className="px-3 py-3 text-right bg-blue-50/50">Cancel% <span className="text-blue-500">F</span></th>
                <th className="px-2 py-3 text-right bg-blue-50/30 border-l border-blue-100">T.Enq</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Enq</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Bkg</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Bkg</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Comp</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Comp</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">T.Rev</th>
                <th className="px-2 py-3 text-right bg-blue-50/30">Y.Rev</th>
                <th className="px-3 py-3 text-right border-l border-green-200 bg-green-50/50">Trips <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Fin Rev <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Margin% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">DQR% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Own% <span className="text-green-600">Fin</span></th>
                <th className="px-3 py-3 text-right bg-green-50/50">Road Rev <span className="text-green-600">Fin</span></th>
                <th className="px-2 py-3 text-right bg-green-50/30 border-l border-green-100">T.Trips</th>
                <th className="px-2 py-3 text-right bg-green-50/30">Y.Trips</th>
                <th className="px-2 py-3 text-right bg-green-50/30">T.FinRev</th>
                <th className="px-2 py-3 text-right bg-green-50/30">Y.FinRev</th>
                <th className="px-3 py-3 text-center">Perf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a, i) => {
                const bkgArr = arrow(a.TODAY_BOOKING, a.YDAY_BOOKING);
                const af = a.fin || {};
                return (
                  <tr key={`${a.CITY}-${a.AGENT}-${i}`} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate sticky left-0 bg-inherit" title={a.AGENT}>{a.agentShort}</td>
                    <td className="px-3 py-2.5 text-gray-600">{a.cityName}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.LOB === 'Hospital' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {a.LOC}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right border-l border-blue-100">{fmt(a.MTD_ENQUIRY)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(a.MTD_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(a.MTD_TRIP_COMP)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtL(a.MTD_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(a.MTD_BKG_CONV_PCT, 50)}>{pct(a.MTD_BKG_CONV_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{pct(a.MTD_TRIP_COMP_PCT)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(a.MTD_CANCEL_PCT, 12, false)}>{pct(a.MTD_CANCEL_PCT)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-xs border-l border-blue-100">{fmt(a.TODAY_ENQUIRY)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(a.YDAY_ENQUIRY)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmt(a.TODAY_BOOKING)} <span className={`${bkgArr.color} text-[10px]`}>{bkgArr.icon}</span></td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(a.YDAY_BOOKING)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmt(a.TODAY_TRIP_COMP)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(a.YDAY_TRIP_COMP)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmtL(a.TODAY_REV_BKD_L)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmtL(a.YDAY_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right border-l border-green-100">{fmt(af.MTD_TRIPS_DELIVERED)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtR(af.MTD_REV)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(af.MTD_MARGIN_PCT, TARGETS.margin_pct)}>{pct(af.MTD_MARGIN_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(af.MTD_DQR_PCT, TARGETS.dqr_pct)}>{pct(af.MTD_DQR_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(af.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}>{pct(af.MTD_OWN_ROAD_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtR(af.MTD_ROAD_REV)}</td>
                    <td className="px-2 py-2.5 text-right text-xs border-l border-green-100">{fmt(af.TODAY_TRIPS)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmt(af.YDAY_TRIPS)}</td>
                    <td className="px-2 py-2.5 text-right text-xs">{fmtR(af.TODAY_REV)}</td>
                    <td className="px-2 py-2.5 text-right text-xs text-gray-400">{fmtR(af.YDAY_REV)}</td>
                    <td className="px-3 py-2.5 text-center"><PerfBadge tier={a.tier} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-400">No agents for selected filters</div>
        )}
        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 border-t">
          Showing {filtered.length} of {processed.length} agents
        </div>
      </div>
    </div>
  );
}

// --- City Row (redesigned with visual distinction) ---

function CityRow({ city }) {
  const [expanded, setExpanded] = useState(false);
  const fin = city.fin || {};

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      {/* Collapsed Header */}
      <div
        className="p-4 cursor-pointer hover:bg-gray-50 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-red-600 font-bold text-sm">
              {city.CITY}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{city.cityName}</h3>
              <span className="text-xs text-gray-400">{city.zone} Zone</span>
            </div>
          </div>

          {/* Collapsed metrics - grouped by section */}
          <div className="hidden md:flex items-center gap-4 text-sm">
            {/* Funnel section */}
            <div className="flex items-center gap-3 pl-4 border-l-2 border-blue-400">
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold">F</span>
              <MetricPill label="Bkg" value={fmt(city.MTD_BOOKING)} />
              <MetricPill label="Rev" value={fmtL(city.MTD_REV_BKD_L)} />
              <MetricPill
                label="Cancel"
                value={pct(city.MTD_CANCEL_PCT)}
                color={statusColor(city.MTD_CANCEL_PCT, 12, false)}
              />
            </div>

            {/* Finance section */}
            <div className="flex items-center gap-3 pl-4 border-l-2 border-green-400">
              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-semibold">Fin</span>
              <MetricPill label="Rev" value={fmtR(fin.MTD_REV)} />
              <MetricPill
                label="Margin"
                value={pct(fin.MTD_MARGIN_PCT)}
                color={statusColor(fin.MTD_MARGIN_PCT, TARGETS.margin_pct)}
              />
              <MetricPill
                label="DQR"
                value={pct(fin.MTD_DQR_PCT)}
                color={statusColor(fin.MTD_DQR_PCT, TARGETS.dqr_pct)}
              />
              <MetricPill
                label="Own Veh"
                value={pct(fin.MTD_OWN_ROAD_PCT)}
                color={statusColor(fin.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}
              />
            </div>
          </div>

          <span className="text-gray-400 text-lg ml-4">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t px-6 pb-6 bg-gray-50">
          <div className="grid lg:grid-cols-2 gap-6 mt-6">
            {/* FUNNEL SECTION */}
            <div className="border-l-4 border-blue-400 bg-blue-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <h4 className="text-sm font-semibold text-blue-900">Funnel Performance</h4>
              </div>

              <div className="bg-white rounded-lg p-3 mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 font-medium uppercase tracking-wider border-b border-gray-200">
                      <th className="text-left pb-2">Metric</th>
                      <th className="text-right pb-2">MTD</th>
                      <th className="text-right pb-2">Today</th>
                      <th className="text-right pb-2">Yesterday</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <FunnelRow label="Enquiries" mtd={city.MTD_ENQUIRY} today={city.TODAY_ENQUIRY} yday={city.YDAY_ENQUIRY} />
                    <FunnelRow label="Bookings" mtd={city.MTD_BOOKING} today={city.TODAY_BOOKING} yday={city.YDAY_BOOKING} />
                    <FunnelRow label="Completed" mtd={city.MTD_TRIP_COMP} today={city.TODAY_TRIP_COMP} yday={city.YDAY_TRIP_COMP} />
                    <FunnelRow label="Rev Booked" mtd={fmtL(city.MTD_REV_BKD_L)} today={fmtL(city.TODAY_REV_BKD_L)} yday={fmtL(city.YDAY_REV_BKD_L)} raw />
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Conv %" value={pct(city.MTD_BKG_CONV_PCT)} />
                <MiniStat label="Completion" value={pct(city.MTD_TRIP_COMP_PCT)} />
                <MiniStat label="Cancel" value={pct(city.MTD_CANCEL_PCT)}
                  color={statusColor(city.MTD_CANCEL_PCT, 12, false)} />
              </div>
            </div>

            {/* FINANCE SECTION */}
            <div className="border-l-4 border-green-400 bg-green-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <h4 className="text-sm font-semibold text-green-900">Finance (Accrual)</h4>
              </div>

              <div className="bg-white rounded-lg p-3 mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 font-medium uppercase tracking-wider border-b border-gray-200">
                      <th className="text-left pb-2">Metric</th>
                      <th className="text-right pb-2">MTD</th>
                      <th className="text-right pb-2">Today</th>
                      <th className="text-right pb-2">Yesterday</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <FunnelRow label="Trips" mtd={fin.MTD_TRIPS_DELIVERED} today={fin.TODAY_TRIPS} yday={fin.YDAY_TRIPS} />
                    <FunnelRow label="Revenue" mtd={fmtR(fin.MTD_REV)} today={fmtR(fin.TODAY_REV)} yday={fmtR(fin.YDAY_REV)} raw />
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Margin %"
                  value={pct(fin.MTD_MARGIN_PCT)}
                  color={statusColor(fin.MTD_MARGIN_PCT, TARGETS.margin_pct)}
                  target="28%" />
                <MiniStat label="DQR %"
                  value={pct(fin.MTD_DQR_PCT)}
                  color={statusColor(fin.MTD_DQR_PCT, TARGETS.dqr_pct)}
                  target="35%" />
                <MiniStat label="Own Vehicle %"
                  value={pct(fin.MTD_OWN_ROAD_PCT)}
                  color={statusColor(fin.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}
                  target="55%" />
                <MiniStat label="Road Revenue" value={fmtR(fin.MTD_ROAD_REV)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function FunnelRow({ label, mtd, today, yday, raw = false }) {
  const a = raw ? { icon: '', color: '' } : arrow(today, yday);
  return (
    <tr>
      <td className="py-1.5 text-gray-700 text-xs">{label}</td>
      <td className="py-1.5 text-right font-medium text-gray-900">{raw ? mtd : fmt(mtd)}</td>
      <td className="py-1.5 text-right text-gray-600">
        {raw ? today : fmt(today)} <span className={`${a.color} text-xs`}>{a.icon}</span>
      </td>
      <td className="py-1.5 text-right text-gray-400 text-xs">{raw ? yday : fmt(yday)}</td>
    </tr>
  );
}

function MiniStat({ label, value, color = 'text-gray-900', target = '' }) {
  return (
    <div className="bg-white rounded-lg p-2.5 text-center">
      <div className="text-xs text-gray-600 font-medium">{label}</div>
      {target && <div className="text-xs text-gray-400">{target}</div>}
      <div className={`text-sm font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
