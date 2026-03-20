'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ZONE_CITY_MAP, CITY_NAMES, TARGETS } from '@/lib/constants';

// ─── Helpers ──────────────────────────────────────────────
const fmt = (n) => n != null ? Number(n).toLocaleString('en-IN') : '—';
const fmtL = (n) => n != null ? `₹${Number(n).toFixed(2)}L` : '—';
const fmtR = (n) => n != null ? `₹${fmt(n)}` : '—';
const pct = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const arrow = (curr, prev) => {
  if (curr == null || prev == null) return { icon: '→', color: 'text-gray-400' };
  const c = Number(curr), p = Number(prev);
  if (c > p) return { icon: '↑', color: 'text-green-700' };
  if (c < p) return { icon: '↓', color: 'text-red-600' };
  return { icon: '→', color: 'text-gray-400' };
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

// ─── Main Page ────────────────────────────────────────────
export default function Dashboard() {
  const [zone, setZone] = useState('All');
  const [selectedCities, setSelectedCities] = useState([]);
  const [activeTab, setActiveTab] = useState('city'); // city | hospital | agent
  const [funnel, setFunnel] = useState(null);
  const [finance, setFinance] = useState(null);
  const [hospitals, setHospitals] = useState(null);
  const [agents, setAgents] = useState(null);
  const [dates, setDates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const zones = ['All', ...Object.keys(ZONE_CITY_MAP)];

  const visibleCities = useMemo(() => {
    if (zone === 'All') return Object.values(ZONE_CITY_MAP).flat();
    return ZONE_CITY_MAP[zone] || [];
  }, [zone]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fRes, finRes, hospRes, agentRes] = await Promise.all([
        fetch('/api/funnel'),
        fetch('/api/finance'),
        fetch('/api/hospital'),
        fetch('/api/agent'),
      ]);
      if (!fRes.ok || !finRes.ok) throw new Error('API request failed');
      const fData = await fRes.json();
      const finData = await finRes.json();
      const hospData = hospRes.ok ? await hospRes.json() : { data: [] };
      const agentData = agentRes.ok ? await agentRes.json() : { data: [] };
      setFunnel(fData.data);
      setFinance(finData.data);
      setHospitals(hospData.data || []);
      setAgents(agentData.data || []);
      setDates(fData.dates);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Merge funnel + finance by city, filter by zone
  const cityData = useMemo(() => {
    if (!funnel || !finance) return [];
    const finMap = {};
    finance.forEach(r => { finMap[r.CITY] = r; });

    return funnel
      .filter(f => visibleCities.includes(f.CITY))
      .filter(f => selectedCities.length === 0 || selectedCities.includes(f.CITY))
      .map(f => ({
        ...f,
        fin: finMap[f.CITY] || {},
        cityName: CITY_NAMES[f.CITY] || f.CITY,
        zone: Object.entries(ZONE_CITY_MAP).find(([, cities]) => cities.includes(f.CITY))?.[0] || '—',
      }));
  }, [funnel, finance, visibleCities, selectedCities]);

  // Filtered hospital data
  const hospitalData = useMemo(() => {
    if (!hospitals) return [];
    return hospitals
      .filter(h => visibleCities.includes(h.CITY))
      .filter(h => selectedCities.length === 0 || selectedCities.includes(h.CITY));
  }, [hospitals, visibleCities, selectedCities]);

  // Filtered agent data
  const agentData = useMemo(() => {
    if (!agents) return [];
    return agents
      .filter(a => visibleCities.includes(a.CITY))
      .filter(a => selectedCities.length === 0 || selectedCities.includes(a.CITY));
  }, [agents, visibleCities, selectedCities]);

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

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">RED.Health City Performance</h1>
              <p className="text-red-100 text-sm mt-1">
                {dates ? `${dates.monthName} | MTD: ${dates.mtdStart} → ${dates.mtdEnd}` : 'Loading...'}
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {loading ? '⟳ Loading...' : '⟳ Refresh'}
            </button>
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
                <SummaryCard label="MTD Bookings" value={fmt(totals.booking)} />
                <SummaryCard label="MTD Completed" value={fmt(totals.tripComp)} />
                <SummaryCard label="Revenue (Booked)" value={fmtL(totals.revL)} />
                <SummaryCard label="Finance Revenue" value={fmtR(totals.finRev)} />
                <SummaryCard
                  label="Margin %"
                  value={pct(totals.marginPct)}
                  color={statusColor(totals.marginPct, TARGETS.margin_pct)}
                />
                <SummaryCard
                  label="Own Vehicle %"
                  value={pct(totals.ownRoadPct)}
                  color={statusColor(totals.ownRoadPct, TARGETS.own_vehicle_pct)}
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
                  />
                  <CompareCell
                    label="Finance Revenue"
                    curr={totals.todayRev} prev={totals.ydayRev}
                    formatter={fmtR}
                  />
                  <CompareCell
                    label="DQR %"
                    curr={totals.dqrPct} prev={null}
                    formatter={pct} single
                    color={statusColor(totals.dqrPct, TARGETS.dqr_pct)}
                  />
                  <CompareCell
                    label="Cancel %"
                    curr={totals.revL > 0 ? (totals.canL / totals.revL * 100).toFixed(1) : null}
                    prev={null}
                    formatter={pct} single
                    color={statusColor(totals.revL > 0 ? (totals.canL / totals.revL * 100) : null, 12, false)}
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
        RED.Health City Dashboard | Data: BLADE.CORE (Snowflake) | Excludes Digital LOB
      </footer>
    </div>
  );
}

// ─── Components ───────────────────────────────────────────

function SummaryCard({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function CompareCell({ label, curr, prev, formatter = fmt, single = false, color = '' }) {
  const a = arrow(curr, prev);
  return (
    <div>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
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

// ─── Hospital Summary ─────────────────────────────────────

function HospitalSummary({ data }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [filterTier, setFilterTier] = useState('all');

  const processed = useMemo(() => {
    return data.map(h => ({
      ...h,
      tier: perfTier(h.MTD_BOOKING, h.MTD_BKG_CONV_PCT, h.MTD_CANCEL_PCT),
      cityName: CITY_NAMES[h.CITY] || h.CITY,
    }));
  }, [data]);

  const filtered = useMemo(() => {
    let items = [...processed];
    if (filterTier !== 'all') {
      items = items.filter(h => h.tier.label === filterTier);
    }
    items.sort((a, b) => {
      if (sortBy === 'revenue') return (Number(b.MTD_REV_BKD_L) || 0) - (Number(a.MTD_REV_BKD_L) || 0);
      if (sortBy === 'bookings') return (Number(b.MTD_BOOKING) || 0) - (Number(a.MTD_BOOKING) || 0);
      if (sortBy === 'conversion') return (Number(b.MTD_BKG_CONV_PCT) || 0) - (Number(a.MTD_BKG_CONV_PCT) || 0);
      return 0;
    });
    return items;
  }, [processed, sortBy, filterTier]);

  const tierCounts = useMemo(() => {
    const counts = { Good: 0, Average: 0, 'Below Avg': 0 };
    processed.forEach(h => { counts[h.tier.label] = (counts[h.tier.label] || 0) + 1; });
    return counts;
  }, [processed]);

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

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 font-medium">Sort by:</span>
        {['revenue', 'bookings', 'conversion'].map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition
              ${sortBy === s ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {filterTier !== 'all' && (
          <button onClick={() => setFilterTier('all')}
            className="ml-2 px-3 py-1 rounded-full text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100">
            Clear filter
          </button>
        )}
      </div>

      {/* Hospital table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Hospital</th>
                <th className="px-3 py-3">City</th>
                <th className="px-3 py-3">LOB</th>
                <th className="px-3 py-3 text-right">Enquiry</th>
                <th className="px-3 py-3 text-right">Bookings</th>
                <th className="px-3 py-3 text-right">Completed</th>
                <th className="px-3 py-3 text-right">Rev (Bkd)</th>
                <th className="px-3 py-3 text-right">Conv %</th>
                <th className="px-3 py-3 text-right">Cancel %</th>
                <th className="px-3 py-3 text-right">Today Bkg</th>
                <th className="px-3 py-3 text-right">Yday Bkg</th>
                <th className="px-3 py-3 text-center">Perf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h, i) => {
                const a = arrow(h.TODAY_BOOKING, h.YDAY_BOOKING);
                return (
                  <tr key={`${h.CITY}-${h.HOSPITAL}-${i}`} className={`${h.tier.bg} hover:bg-opacity-80 transition`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={h.HOSPITAL}>{h.HOSPITAL}</td>
                    <td className="px-3 py-2.5 text-gray-600">{h.cityName}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${h.LOB === 'Hospital' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {h.LOB}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt(h.MTD_ENQUIRY)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(h.MTD_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(h.MTD_TRIP_COMP)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtL(h.MTD_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(h.MTD_BKG_CONV_PCT, 50)}>{pct(h.MTD_BKG_CONV_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(h.MTD_CANCEL_PCT, 12, false)}>{pct(h.MTD_CANCEL_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt(h.TODAY_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">
                      {fmt(h.YDAY_BOOKING)} <span className={`text-xs ${a.color}`}>{a.icon}</span>
                    </td>
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

// ─── Agent Summary ────────────────────────────────────────

function AgentSummary({ data }) {
  const [sortBy, setSortBy] = useState('revenue');
  const [filterTier, setFilterTier] = useState('all');

  const processed = useMemo(() => {
    return data.map(a => ({
      ...a,
      tier: perfTier(a.MTD_BOOKING, a.MTD_BKG_CONV_PCT, a.MTD_CANCEL_PCT),
      cityName: CITY_NAMES[a.CITY] || a.CITY,
      agentShort: (a.AGENT || '').split('@')[0] || 'Unknown',
    }));
  }, [data]);

  const filtered = useMemo(() => {
    let items = [...processed];
    if (filterTier !== 'all') {
      items = items.filter(a => a.tier.label === filterTier);
    }
    items.sort((a, b) => {
      if (sortBy === 'revenue') return (Number(b.MTD_REV_BKD_L) || 0) - (Number(a.MTD_REV_BKD_L) || 0);
      if (sortBy === 'bookings') return (Number(b.MTD_BOOKING) || 0) - (Number(a.MTD_BOOKING) || 0);
      if (sortBy === 'conversion') return (Number(b.MTD_BKG_CONV_PCT) || 0) - (Number(a.MTD_BKG_CONV_PCT) || 0);
      return 0;
    });
    return items;
  }, [processed, sortBy, filterTier]);

  const tierCounts = useMemo(() => {
    const counts = { Good: 0, Average: 0, 'Below Avg': 0 };
    processed.forEach(a => { counts[a.tier.label] = (counts[a.tier.label] || 0) + 1; });
    return counts;
  }, [processed]);

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

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 font-medium">Sort by:</span>
        {['revenue', 'bookings', 'conversion'].map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition
              ${sortBy === s ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {filterTier !== 'all' && (
          <button onClick={() => setFilterTier('all')}
            className="ml-2 px-3 py-1 rounded-full text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100">
            Clear filter
          </button>
        )}
      </div>

      {/* Agent table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Agent</th>
                <th className="px-3 py-3">City</th>
                <th className="px-3 py-3">LOB</th>
                <th className="px-3 py-3 text-right">Enquiry</th>
                <th className="px-3 py-3 text-right">Bookings</th>
                <th className="px-3 py-3 text-right">Completed</th>
                <th className="px-3 py-3 text-right">Rev (Bkd)</th>
                <th className="px-3 py-3 text-right">Conv %</th>
                <th className="px-3 py-3 text-right">Cancel %</th>
                <th className="px-3 py-3 text-right">Today Bkg</th>
                <th className="px-3 py-3 text-right">Yday Bkg</th>
                <th className="px-3 py-3 text-center">Perf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((a, i) => {
                const ar = arrow(a.TODAY_BOOKING, a.YDAY_BOOKING);
                return (
                  <tr key={`${a.CITY}-${a.AGENT}-${i}`} className={`${a.tier.bg} hover:bg-opacity-80 transition`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={a.AGENT}>{a.agentShort}</td>
                    <td className="px-3 py-2.5 text-gray-600">{a.cityName}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.LOB === 'Hospital' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {a.LOB}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt(a.MTD_ENQUIRY)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmt(a.MTD_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt(a.MTD_TRIP_COMP)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{fmtL(a.MTD_REV_BKD_L)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(a.MTD_BKG_CONV_PCT, 50)}>{pct(a.MTD_BKG_CONV_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={statusColor(a.MTD_CANCEL_PCT, 12, false)}>{pct(a.MTD_CANCEL_PCT)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmt(a.TODAY_BOOKING)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">
                      {fmt(a.YDAY_BOOKING)} <span className={`text-xs ${ar.color}`}>{ar.icon}</span>
                    </td>
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

// ─── City Row (existing) ──────────────────────────────────

function CityRow({ city }) {
  const [expanded, setExpanded] = useState(false);
  const fin = city.fin || {};

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
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

          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-center">
              <div className="text-xs text-gray-400">Bookings</div>
              <div className="font-semibold">{fmt(city.MTD_BOOKING)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Rev (Booked)</div>
              <div className="font-semibold">{fmtL(city.MTD_REV_BKD_L)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Finance Rev</div>
              <div className="font-semibold">{fmtR(fin.MTD_REV)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Margin</div>
              <div className={statusColor(fin.MTD_MARGIN_PCT, TARGETS.margin_pct)}>
                {pct(fin.MTD_MARGIN_PCT)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Own Veh</div>
              <div className={statusColor(fin.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}>
                {pct(fin.MTD_OWN_ROAD_PCT)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">DQR</div>
              <div className={statusColor(fin.MTD_DQR_PCT, TARGETS.dqr_pct)}>
                {pct(fin.MTD_DQR_PCT)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-400">Cancel</div>
              <div className={statusColor(city.MTD_CANCEL_PCT, 12, false)}>
                {pct(city.MTD_CANCEL_PCT)}
              </div>
            </div>
          </div>

          <span className="text-gray-400 text-lg">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 pb-4">
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Funnel Performance</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="pb-2">Metric</th>
                    <th className="pb-2 text-right">MTD</th>
                    <th className="pb-2 text-right">Today</th>
                    <th className="pb-2 text-right">Yesterday</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <FunnelRow label="Enquiries" mtd={city.MTD_ENQUIRY} today={city.TODAY_ENQUIRY} yday={city.YDAY_ENQUIRY} />
                  <FunnelRow label="Bookings" mtd={city.MTD_BOOKING} today={city.TODAY_BOOKING} yday={city.YDAY_BOOKING} />
                  <FunnelRow label="Completed" mtd={city.MTD_TRIP_COMP} today={city.TODAY_TRIP_COMP} yday={city.YDAY_TRIP_COMP} />
                  <FunnelRow label="Rev Booked" mtd={fmtL(city.MTD_REV_BKD_L)} today={fmtL(city.TODAY_REV_BKD_L)} yday={fmtL(city.YDAY_REV_BKD_L)} raw />
                </tbody>
              </table>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <MiniStat label="Conv %" value={pct(city.MTD_BKG_CONV_PCT)} />
                <MiniStat label="Completion" value={pct(city.MTD_TRIP_COMP_PCT)} />
                <MiniStat label="Cancel" value={pct(city.MTD_CANCEL_PCT)}
                  color={statusColor(city.MTD_CANCEL_PCT, 12, false)} />
              </div>
            </div>

            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Finance (Accrual)</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="pb-2">Metric</th>
                    <th className="pb-2 text-right">MTD</th>
                    <th className="pb-2 text-right">Today</th>
                    <th className="pb-2 text-right">Yesterday</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <FunnelRow label="Trips" mtd={fin.MTD_TRIPS_DELIVERED} today={fin.TODAY_TRIPS} yday={fin.YDAY_TRIPS} />
                  <FunnelRow label="Revenue" mtd={fmtR(fin.MTD_REV)} today={fmtR(fin.TODAY_REV)} yday={fmtR(fin.YDAY_REV)} raw />
                </tbody>
              </table>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <MiniStat label="Margin"
                  value={pct(fin.MTD_MARGIN_PCT)}
                  color={statusColor(fin.MTD_MARGIN_PCT, TARGETS.margin_pct)}
                  target="≥28%" />
                <MiniStat label="DQR"
                  value={pct(fin.MTD_DQR_PCT)}
                  color={statusColor(fin.MTD_DQR_PCT, TARGETS.dqr_pct)}
                  target="≥35%" />
                <MiniStat label="Own Veh"
                  value={pct(fin.MTD_OWN_ROAD_PCT)}
                  color={statusColor(fin.MTD_OWN_ROAD_PCT, TARGETS.own_vehicle_pct)}
                  target="≥55%" />
                <MiniStat label="Road Rev" value={fmtR(fin.MTD_ROAD_REV)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FunnelRow({ label, mtd, today, yday, raw = false }) {
  const a = raw ? { icon: '', color: '' } : arrow(today, yday);
  return (
    <tr>
      <td className="py-1.5 text-gray-600">{label}</td>
      <td className="py-1.5 text-right font-medium">{raw ? mtd : fmt(mtd)}</td>
      <td className="py-1.5 text-right">
        {raw ? today : fmt(today)} <span className={`${a.color} text-xs`}>{a.icon}</span>
      </td>
      <td className="py-1.5 text-right text-gray-400">{raw ? yday : fmt(yday)}</td>
    </tr>
  );
}

function MiniStat({ label, value, color = 'text-gray-900', target = '' }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-xs text-gray-400">{label} {target && <span className="text-gray-300">({target})</span>}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}
