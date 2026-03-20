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

// ─── Main Page ────────────────────────────────────────────
export default function Dashboard() {
  const [zone, setZone] = useState('All');
  const [selectedCities, setSelectedCities] = useState([]);
  const [funnel, setFunnel] = useState(null);
  const [finance, setFinance] = useState(null);
  const [dates, setDates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const zones = ['All', ...Object.keys(ZONE_CITY_MAP)];

  // Compute visible cities based on zone filter
  const visibleCities = useMemo(() => {
    if (zone === 'All') return Object.values(ZONE_CITY_MAP).flat();
    return ZONE_CITY_MAP[zone] || [];
  }, [zone]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fRes, finRes] = await Promise.all([
        fetch('/api/funnel'),
        fetch('/api/finance'),
      ]);
      if (!fRes.ok || !finRes.ok) throw new Error('API request failed');
      const fData = await fRes.json();
      const finData = await finRes.json();
      setFunnel(fData.data);
      setFinance(finData.data);
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
      ydayTrips: sumFin('YDAY_TRIPS'), ydayRev: sumFin('YDAY_REV'),
      dbyestTrips: sumFin('DBYEST_TRIPS'), dbyestRev: sumFin('DBYEST_REV'),
    };
  }, [cityData]);

  // Toggle city selection
  const toggleCity = (code) => {
    setSelectedCities(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

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

            {/* Yesterday vs Day-Before Quick Compare */}
            {totals && (
              <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Yesterday vs Day Before</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <CompareCell
                    label="Trips Delivered"
                    yday={totals.ydayTrips} dbyest={totals.dbyestTrips}
                  />
                  <CompareCell
                    label="Finance Revenue"
                    yday={totals.ydayRev} dbyest={totals.dbyestRev}
                    formatter={fmtR}
                  />
                  <CompareCell
                    label="DQR %"
                    yday={totals.dqrPct} dbyest={null}
                    formatter={pct} single
                    color={statusColor(totals.dqrPct, TARGETS.dqr_pct)}
                  />
                  <CompareCell
                    label="Cancel %"
                    yday={totals.revL > 0 ? (totals.canL / totals.revL * 100).toFixed(1) : null}
                    dbyest={null}
                    formatter={pct} single
                    color={statusColor(totals.revL > 0 ? (totals.canL / totals.revL * 100) : null, 12, false)}
                  />
                </div>
              </div>
            )}

            {/* City Cards Grid */}
            <div className="space-y-4">
              {cityData.map(city => (
                <CityRow key={city.CITY} city={city} />
              ))}
            </div>

            {cityData.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-400">
                No data for selected filters
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
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

function CompareCell({ label, yday, dbyest, formatter = fmt, single = false, color = '' }) {
  const a = arrow(yday, dbyest);
  return (
    <div>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      {single ? (
        <div className={`text-lg font-bold ${color}`}>{formatter(yday)}</div>
      ) : (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-lg font-bold">{formatter(yday)}</span>
          <span className={`text-sm ${a.color}`}>{a.icon}</span>
          <span className="text-sm text-gray-400">vs {formatter(dbyest)}</span>
        </div>
      )}
    </div>
  );
}

function CityRow({ city }) {
  const [expanded, setExpanded] = useState(false);
  const fin = city.fin || {};
  const revArrow = arrow(fin.YDAY_REV, fin.DBYEST_REV);
  const tripArrow = arrow(fin.YDAY_TRIPS, fin.DBYEST_TRIPS);

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      {/* City Header — always visible */}
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

          {/* Key metrics inline */}
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

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 pb-4">
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {/* Funnel Table */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Funnel Performance</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="pb-2">Metric</th>
                    <th className="pb-2 text-right">MTD</th>
                    <th className="pb-2 text-right">Yesterday</th>
                    <th className="pb-2 text-right">Day Before</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <FunnelRow label="Enquiries" mtd={city.MTD_ENQUIRY} yday={city.YDAY_ENQUIRY} dbyest={city.DBYEST_ENQUIRY} />
                  <FunnelRow label="Bookings" mtd={city.MTD_BOOKING} yday={city.YDAY_BOOKING} dbyest={city.DBYEST_BOOKING} />
                  <FunnelRow label="Completed" mtd={city.MTD_TRIP_COMP} yday={city.YDAY_TRIP_COMP} dbyest={city.DBYEST_TRIP_COMP} />
                  <FunnelRow label="Rev Booked" mtd={fmtL(city.MTD_REV_BKD_L)} yday={fmtL(city.YDAY_REV_BKD_L)} dbyest={fmtL(city.DBYEST_REV_BKD_L)} raw />
                </tbody>
              </table>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <MiniStat label="Conv %" value={pct(city.MTD_BKG_CONV_PCT)} />
                <MiniStat label="Completion" value={pct(city.MTD_TRIP_COMP_PCT)} />
                <MiniStat label="Cancel" value={pct(city.MTD_CANCEL_PCT)}
                  color={statusColor(city.MTD_CANCEL_PCT, 12, false)} />
              </div>
            </div>

            {/* Finance Table */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Finance (Accrual)</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="pb-2">Metric</th>
                    <th className="pb-2 text-right">MTD</th>
                    <th className="pb-2 text-right">Yesterday</th>
                    <th className="pb-2 text-right">Day Before</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <FunnelRow label="Trips" mtd={fin.MTD_TRIPS_DELIVERED} yday={fin.YDAY_TRIPS} dbyest={fin.DBYEST_TRIPS} />
                  <FunnelRow label="Revenue" mtd={fmtR(fin.MTD_REV)} yday={fmtR(fin.YDAY_REV)} dbyest={fmtR(fin.DBYEST_REV)} raw />
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

function FunnelRow({ label, mtd, yday, dbyest, raw = false }) {
  const a = raw ? { icon: '', color: '' } : arrow(yday, dbyest);
  return (
    <tr>
      <td className="py-1.5 text-gray-600">{label}</td>
      <td className="py-1.5 text-right font-medium">{raw ? mtd : fmt(mtd)}</td>
      <td className="py-1.5 text-right">
        {raw ? yday : fmt(yday)} <span className={`${a.color} text-xs`}>{a.icon}</span>
      </td>
      <td className="py-1.5 text-right text-gray-400">{raw ? dbyest : fmt(dbyest)}</td>
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
