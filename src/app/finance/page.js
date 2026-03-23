'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CITY_NAMES } from '@/lib/constants';

// --- Helpers ---
const fmt = (n) => n != null ? Number(n).toLocaleString('en-IN') : '\u2014';
const fmtR = (n) => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u2014';
const fmtL = (n) => n != null ? '\u20B9' + (Number(n)/100000).toFixed(2) + 'L' : '\u2014';
const pct = (n) => n != null ? Number(n).toFixed(1) + '%' : '\u2014';

const SERVICE_LABELS = {
  ROAD_AMBULANCE: 'Road Ambulance',
  DEAD_BODY_ROAD_TRANSPORT: 'Dead Body Road',
  DEAD_BODY_AIR_CARGO: 'Dead Body Air',
  UNKNOWN: 'Unknown',
};

const PROVIDER_LABELS = {
  OWNED: 'Owned',
  ALLIANCE: 'Alliance',
  PARTNER: 'Partner',
  NON_PARTNER: 'Non-Partner',
  UNKNOWN: 'Unknown',
};

const PROVIDER_COLORS = {
  OWNED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  ALLIANCE: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  PARTNER: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  NON_PARTNER: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  UNKNOWN: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-500' },
};

// Financial Health Score calculation (Step 8)
function calcHealthScore(hospital) {
  let score = 0;
  const maxScore = 8;

  // 1. Conversion Rate (Funnel -> Finance): higher is better
  const convRate = hospital.funnelRev > 0 ? (hospital.financeRev / hospital.funnelRev) * 100 : 0;
  if (convRate >= 80) score += 2;
  else if (convRate >= 60) score += 1;

  // 2. Credit Exposure (bill_to_client %): lower is better
  const totalRev = hospital.financeRev || hospital.funnelRev || 1;
  const creditPct = ((hospital.financeBillToClient || hospital.funnelBillToClient || 0) / totalRev) * 100;
  if (creditPct <= 30) score += 2;
  else if (creditPct <= 60) score += 1;

  // 3. Volume Consistency (has both today and yesterday activity)
  const hasToday = (hospital.financeTodayTrips || 0) > 0 || (hospital.funnelTodayBookings || 0) > 0;
  const hasYday = (hospital.financeYdayTrips || 0) > 0 || (hospital.funnelYdayBookings || 0) > 0;
  if (hasToday && hasYday) score += 2;
  else if (hasToday || hasYday) score += 1;

  // 4. Contribution Share: not too concentrated (dependency risk)
  // This is contextual, scored at aggregation level
  if (hospital.contributionPct !== undefined) {
    if (hospital.contributionPct <= 15) score += 2;
    else if (hospital.contributionPct <= 30) score += 1;
  } else {
    score += 1; // neutral
  }

  const pctScore = (score / maxScore) * 100;
  if (pctScore >= 62.5) return { label: 'Healthy', emoji: '\uD83D\uDFE2', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', score, convRate, creditPct };
  if (pctScore >= 37.5) return { label: 'Moderate Risk', emoji: '\uD83D\uDFE1', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', score, convRate, creditPct };
  return { label: 'High Risk', emoji: '\uD83D\uDD34', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', score, convRate, creditPct };
}

// --- Main Page ---
export default function FinanceAnalytics() {
  const router = useRouter();
  const [funnelData, setFunnelData] = useState(null);
  const [financeData, setFinanceData] = useState(null);
  const [dates, setDates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');
  const [sessionToken, setSessionToken] = useState('');

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('dash_token') : null;
    if (!token) { router.push('/login'); return; }
    setSessionToken(token);
    fetch('/api/auth?token=' + token)
      .then(r => r.json())
      .then(d => {
        if (!d.authenticated) { localStorage.removeItem('dash_token'); router.push('/login'); return; }
        setSessionToken(token);
      })
      .catch(() => { router.push('/login'); });
  }, [router]);

  const fetchData = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    try {
      const hdrs = { 'x-session-token': sessionToken };
      const [fRes, finRes] = await Promise.all([
        fetch('/api/data?type=finance-analytics-funnel', { headers: hdrs }),
        fetch('/api/data?type=finance-analytics-finance', { headers: hdrs }),
      ]);
      if (fRes.status === 401 || finRes.status === 401) {
        localStorage.removeItem('dash_token');
        router.push('/login');
        return;
      }
      if (!fRes.ok || !finRes.ok) throw new Error('API request failed');
      const fData = await fRes.json();
      const finData = await finRes.json();
      setFunnelData(fData.data || []);
      setFinanceData(finData.data || []);
      setDates(fData.dates);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, router]);

  useEffect(() => { if (sessionToken) fetchData(); }, [fetchData, sessionToken]);

  // --- Aggregations ---

  // Provider Type aggregation (Step 9)
  const providerAgg = useMemo(() => {
    if (!funnelData || !financeData) return [];
    const map = {};
    const addToMap = (rows, prefix) => {
      rows.forEach(r => {
        const pt = r.PROVIDER_TYPE || 'UNKNOWN';
        if (!map[pt]) map[pt] = { provider: pt, funnelRev: 0, financeRev: 0, funnelBookings: 0, financeTrips: 0, funnelMargin: 0, financeMargin: 0, funnelBillToClient: 0, funnelDirectPay: 0, financeBillToClient: 0, financeDirectPay: 0, serviceTypes: {} };
        if (prefix === 'funnel') {
          map[pt].funnelRev += Number(r.TOTAL_REV) || 0;
          map[pt].funnelBookings += Number(r.TOTAL_BOOKINGS) || 0;
          map[pt].funnelMargin += Number(r.MARGIN_AMT) || 0;
          map[pt].funnelBillToClient += Number(r.BILL_TO_CLIENT_REV) || 0;
          map[pt].funnelDirectPay += Number(r.DIRECT_PAY_REV) || 0;
          const st = r.SERVICE_TYPE || 'UNKNOWN';
          if (!map[pt].serviceTypes[st]) map[pt].serviceTypes[st] = { funnel: 0, finance: 0 };
          map[pt].serviceTypes[st].funnel += Number(r.TOTAL_REV) || 0;
        } else {
          map[pt].financeRev += Number(r.TOTAL_REV) || 0;
          map[pt].financeTrips += Number(r.TOTAL_TRIPS) || 0;
          map[pt].financeMargin += Number(r.MARGIN_AMT) || 0;
          map[pt].financeBillToClient += Number(r.BILL_TO_CLIENT_REV) || 0;
          map[pt].financeDirectPay += Number(r.DIRECT_PAY_REV) || 0;
          const st = r.SERVICE_TYPE || 'UNKNOWN';
          if (!map[pt].serviceTypes[st]) map[pt].serviceTypes[st] = { funnel: 0, finance: 0 };
          map[pt].serviceTypes[st].finance += Number(r.TOTAL_REV) || 0;
        }
      });
    };
    addToMap(funnelData, 'funnel');
    addToMap(financeData, 'finance');
    return Object.values(map).sort((a, b) => b.financeRev - a.financeRev);
  }, [funnelData, financeData]);

  // Hospital aggregation (Step 6, 7, 8)
  const hospitalAgg = useMemo(() => {
    if (!funnelData || !financeData) return [];
    const map = {};
    const totalFunnelRev = funnelData.reduce((s, r) => s + (Number(r.TOTAL_REV) || 0), 0);
    const totalFinanceRev = financeData.reduce((s, r) => s + (Number(r.TOTAL_REV) || 0), 0);

    const addToMap = (rows, prefix) => {
      rows.forEach(r => {
        const h = r.HOSPITAL || 'Unknown Hospital';
        if (!map[h]) map[h] = {
          hospital: h, city: r.CITY,
          funnelRev: 0, financeRev: 0, funnelBookings: 0, financeTrips: 0,
          funnelMargin: 0, financeMargin: 0,
          funnelBillToClient: 0, funnelDirectPay: 0, financeBillToClient: 0, financeDirectPay: 0,
          funnelTodayBookings: 0, funnelYdayBookings: 0, financeTodayTrips: 0, financeYdayTrips: 0,
          providers: {}, serviceTypes: {}
        };
        if (prefix === 'funnel') {
          map[h].funnelRev += Number(r.TOTAL_REV) || 0;
          map[h].funnelBookings += Number(r.TOTAL_BOOKINGS) || 0;
          map[h].funnelMargin += Number(r.MARGIN_AMT) || 0;
          map[h].funnelBillToClient += Number(r.BILL_TO_CLIENT_REV) || 0;
          map[h].funnelDirectPay += Number(r.DIRECT_PAY_REV) || 0;
          map[h].funnelTodayBookings += Number(r.TODAY_BOOKINGS) || 0;
          map[h].funnelYdayBookings += Number(r.YDAY_BOOKINGS) || 0;
        } else {
          map[h].financeRev += Number(r.TOTAL_REV) || 0;
          map[h].financeTrips += Number(r.TOTAL_TRIPS) || 0;
          map[h].financeMargin += Number(r.MARGIN_AMT) || 0;
          map[h].financeBillToClient += Number(r.BILL_TO_CLIENT_REV) || 0;
          map[h].financeDirectPay += Number(r.DIRECT_PAY_REV) || 0;
          map[h].financeTodayTrips += Number(r.TODAY_TRIPS) || 0;
          map[h].financeYdayTrips += Number(r.YDAY_TRIPS) || 0;
        }
        // Provider breakdown
        const pt = r.PROVIDER_TYPE || 'UNKNOWN';
        if (!map[h].providers[pt]) map[h].providers[pt] = { funnel: 0, finance: 0 };
        map[h].providers[pt][prefix] += Number(r.TOTAL_REV || r.TOTAL_REV) || 0;
        // Service type breakdown
        const st = r.SERVICE_TYPE || 'UNKNOWN';
        if (!map[h].serviceTypes[st]) map[h].serviceTypes[st] = { funnel: 0, finance: 0 };
        map[h].serviceTypes[st][prefix] += Number(r.TOTAL_REV) || 0;
      });
    };
    addToMap(funnelData, 'funnel');
    addToMap(financeData, 'finance');

    return Object.values(map).map(h => {
      const funnelContrib = totalFunnelRev > 0 ? (h.funnelRev / totalFunnelRev) * 100 : 0;
      const financeContrib = totalFinanceRev > 0 ? (h.financeRev / totalFinanceRev) * 100 : 0;
      const contributionPct = Math.max(funnelContrib, financeContrib);
      const variance = h.funnelRev - h.financeRev;
      const conversionPct = h.funnelRev > 0 ? (h.financeRev / h.funnelRev) * 100 : 0;
      const health = calcHealthScore({ ...h, contributionPct });
      return { ...h, funnelContrib, financeContrib, contributionPct, variance, conversionPct, health };
    }).sort((a, b) => b.financeRev - a.financeRev);
  }, [funnelData, financeData]);

  // Cash flow buckets (Step 5)
  const cashFlow = useMemo(() => {
    if (!funnelData || !financeData) return null;
    const realized = financeData.reduce((s, r) => s + (Number(r.DIRECT_PAY_REV) || 0), 0);
    const pipeline = funnelData.reduce((s, r) => s + (Number(r.DIRECT_PAY_REV) || 0), 0);
    const creditFinance = financeData.reduce((s, r) => s + (Number(r.BILL_TO_CLIENT_REV) || 0), 0);
    const creditFunnel = funnelData.reduce((s, r) => s + (Number(r.BILL_TO_CLIENT_REV) || 0), 0);
    const totalFunnel = funnelData.reduce((s, r) => s + (Number(r.TOTAL_REV) || 0), 0);
    const totalFinance = financeData.reduce((s, r) => s + (Number(r.TOTAL_REV) || 0), 0);
    const totalFunnelBookings = funnelData.reduce((s, r) => s + (Number(r.TOTAL_BOOKINGS) || 0), 0);
    const totalFinanceTrips = financeData.reduce((s, r) => s + (Number(r.TOTAL_TRIPS) || 0), 0);
    return { realized, pipeline, creditFinance, creditFunnel, totalFunnel, totalFinance, totalFunnelBookings, totalFinanceTrips };
  }, [funnelData, financeData]);

  // Overall totals
  const totals = useMemo(() => {
    if (!cashFlow) return null;
    const totalMarginFunnel = funnelData.reduce((s, r) => s + (Number(r.MARGIN_AMT) || 0), 0);
    const totalMarginFinance = financeData.reduce((s, r) => s + (Number(r.MARGIN_AMT) || 0), 0);
    return { ...cashFlow, totalMarginFunnel, totalMarginFinance };
  }, [cashFlow, funnelData, financeData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Finance Analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md">
          <h3 className="text-red-700 font-semibold mb-2">Error Loading Data</h3>
          <p className="text-red-600 text-sm">{error}</p>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Retry</button>
        </div>
      </div>
    );
  }

  const sections = [
    { id: 'overview', label: 'Cash Flow Overview' },
    { id: 'providers', label: 'Provider Analysis' },
    { id: 'hospitals', label: 'Hospital Health' },
    { id: 'variance', label: 'Variance & Leakage' },
    { id: 'insights', label: 'Strategic Insights' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push('/')} className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600">&larr; Dashboard</button>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Finance Analytics</h1>
                <p className="text-xs text-gray-500">{dates?.monthName} &middot; {dates?.reportDate}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded font-medium">Funnel: {fmt(totals?.totalFunnelBookings)} bookings</span>
              <span className="px-2 py-1 bg-green-50 text-green-700 rounded font-medium">Finance: {fmt(totals?.totalFinanceTrips)} trips</span>
            </div>
          </div>
          {/* Section tabs */}
          <div className="flex gap-1 mt-3 -mb-px">
            {sections.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className={`px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 transition ${activeSection === s.id ? 'border-red-600 text-red-700 bg-red-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6 space-y-6">

        {/* SECTION: Cash Flow Overview (Steps 3, 4, 5) */}
        {activeSection === 'overview' && totals && (
          <div className="space-y-6">
            {/* Cash Flow Buckets */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <CashBucket
                title="Realized Cash"
                subtitle="Finance booked, direct patient payment"
                amount={totals.realized}
                totalRef={totals.totalFinance}
                color="green" icon="\u2705"
              />
              <CashBucket
                title="Pipeline Cash"
                subtitle="Funnel bookings, direct payment expected"
                amount={totals.pipeline}
                totalRef={totals.totalFunnel}
                color="blue" icon="\u23F3"
              />
              <CashBucket
                title="Credit-Based Revenue"
                subtitle="Bill-to-client (delayed cash inflow)"
                amount={totals.creditFinance + totals.creditFunnel}
                totalRef={totals.totalFinance + totals.totalFunnel}
                color="amber" icon="\u26A0\uFE0F"
                detail={`Finance: ${fmtR(totals.creditFinance)} | Funnel: ${fmtR(totals.creditFunnel)}`}
              />
            </div>

            {/* Dual Financial View - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FinancialViewCard
                title="Funnel View (Cash Inflow Projection)"
                icon="F" iconColor="blue"
                totalRev={totals.totalFunnel}
                totalVolume={totals.totalFunnelBookings}
                volumeLabel="Bookings"
                margin={totals.totalMarginFunnel}
                directPay={totals.pipeline}
                billToClient={totals.creditFunnel}
              />
              <FinancialViewCard
                title="Finance View (Actual Cash Booked)"
                icon="Fin" iconColor="green"
                totalRev={totals.totalFinance}
                totalVolume={totals.totalFinanceTrips}
                volumeLabel="Delivered Trips"
                margin={totals.totalMarginFinance}
                directPay={totals.realized}
                billToClient={totals.creditFinance}
              />
            </div>

            {/* Funnel vs Finance Gap */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="font-semibold text-gray-900 text-sm mb-4">Funnel &rarr; Finance Conversion</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MiniMetric label="Funnel Revenue" value={fmtR(totals.totalFunnel)} />
                <MiniMetric label="Finance Revenue" value={fmtR(totals.totalFinance)} />
                <MiniMetric label="Revenue Gap" value={fmtR(totals.totalFunnel - totals.totalFinance)}
                  color={totals.totalFunnel - totals.totalFinance > 0 ? 'text-red-600' : 'text-green-600'} />
                <MiniMetric label="Conversion %"
                  value={totals.totalFunnel > 0 ? pct((totals.totalFinance / totals.totalFunnel) * 100) : '\u2014'}
                  color={totals.totalFunnel > 0 && (totals.totalFinance / totals.totalFunnel) >= 0.8 ? 'text-green-600' : 'text-amber-600'} />
              </div>
            </div>
          </div>
        )}

        {/* SECTION: Provider Analysis (Step 9) */}
        {activeSection === 'providers' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Assignment Provider Type Analysis</h2>
            {providerAgg.map(p => {
              const colors = PROVIDER_COLORS[p.provider] || PROVIDER_COLORS.UNKNOWN;
              const totalFRev = providerAgg.reduce((s, x) => s + x.funnelRev, 0);
              const totalFinRev = providerAgg.reduce((s, x) => s + x.financeRev, 0);
              const convPct = p.funnelRev > 0 ? (p.financeRev / p.funnelRev * 100) : 0;
              const cashPct = p.financeRev > 0 ? (p.financeDirectPay / p.financeRev * 100) : 0;
              const creditPct = p.financeRev > 0 ? (p.financeBillToClient / p.financeRev * 100) : 0;
              const marginPct = p.financeRev > 0 ? (p.financeMargin / p.financeRev * 100) : 0;
              return (
                <div key={p.provider} className={`bg-white rounded-xl shadow-sm border ${colors.border} overflow-hidden`}>
                  <div className={`px-5 py-3 ${colors.bg} border-b ${colors.border} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${colors.dot}`}></div>
                      <h3 className={`font-semibold text-sm ${colors.text}`}>{PROVIDER_LABELS[p.provider] || p.provider}</h3>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-blue-600">Funnel: {pct(totalFRev > 0 ? p.funnelRev / totalFRev * 100 : 0)} contrib</span>
                      <span className="text-green-600">Finance: {pct(totalFinRev > 0 ? p.financeRev / totalFinRev * 100 : 0)} contrib</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                      <MiniMetric label="Funnel Rev" value={fmtR(p.funnelRev)} sub={`${fmt(p.funnelBookings)} bkgs`} />
                      <MiniMetric label="Finance Rev" value={fmtR(p.financeRev)} sub={`${fmt(p.financeTrips)} trips`} />
                      <MiniMetric label="Conversion" value={pct(convPct)} color={convPct >= 80 ? 'text-green-600' : convPct >= 60 ? 'text-amber-600' : 'text-red-600'} />
                      <MiniMetric label="Margin" value={fmtR(p.financeMargin)} sub={pct(marginPct)} />
                      <MiniMetric label="Direct Pay" value={fmtR(p.financeDirectPay)} sub={pct(cashPct)} color="text-green-600" />
                      <MiniMetric label="Bill-to-Client" value={fmtR(p.financeBillToClient)} sub={pct(creditPct)} color="text-amber-600" />
                      <MiniMetric label="Revenue Gap" value={fmtR(p.funnelRev - p.financeRev)} color={p.funnelRev - p.financeRev > 0 ? 'text-red-600' : 'text-green-600'} />
                    </div>
                    {/* Service type mix */}
                    <div className="border-t pt-3">
                      <p className="text-xs text-gray-500 font-medium mb-2">Service Type Mix</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(p.serviceTypes).map(([st, vals]) => (
                          <div key={st} className="px-3 py-1.5 bg-gray-50 rounded-lg text-xs">
                            <span className="font-medium text-gray-700">{SERVICE_LABELS[st] || st}</span>
                            <span className="text-blue-600 ml-2">F: {fmtR(vals.funnel)}</span>
                            <span className="text-green-600 ml-2">Fin: {fmtR(vals.finance)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SECTION: Hospital Health (Steps 6, 7, 8) */}
        {activeSection === 'hospitals' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Hospital Financial Health Assessment</h2>
              <div className="flex gap-2 text-xs">
                <span className="px-2 py-1 bg-green-50 text-green-700 rounded">{hospitalAgg.filter(h => h.health.label === 'Healthy').length} Healthy</span>
                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded">{hospitalAgg.filter(h => h.health.label === 'Moderate Risk').length} Moderate</span>
                <span className="px-2 py-1 bg-red-50 text-red-700 rounded">{hospitalAgg.filter(h => h.health.label === 'High Risk').length} High Risk</span>
              </div>
            </div>

            {/* Health Score Explanation */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-500 font-medium mb-2">Health Score Criteria (max 8 pts)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-gray-50 rounded p-2"><strong>Conversion Rate</strong> (0-2): Funnel&rarr;Finance &ge;80% = 2, &ge;60% = 1</div>
                <div className="bg-gray-50 rounded p-2"><strong>Credit Exposure</strong> (0-2): Bill-to-client &le;30% = 2, &le;60% = 1</div>
                <div className="bg-gray-50 rounded p-2"><strong>Volume Consistency</strong> (0-2): Activity today+yesterday = 2, either = 1</div>
                <div className="bg-gray-50 rounded p-2"><strong>Concentration Risk</strong> (0-2): Contribution &le;15% = 2, &le;30% = 1</div>
              </div>
              <p className="text-xs text-gray-400 mt-2">&ge;5 pts = Healthy | 3-4 pts = Moderate Risk | &le;2 pts = High Risk</p>
            </div>

            {/* Hospital Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider z-10 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                    <tr>
                      <th className="px-4 py-3 sticky left-0 bg-gray-50 z-20">Hospital</th>
                      <th className="px-3 py-3">City</th>
                      <th className="px-3 py-3 text-center">Health</th>
                      <th className="px-3 py-3 text-right border-l border-blue-200 bg-blue-50/50">Funnel Rev</th>
                      <th className="px-3 py-3 text-right bg-blue-50/50">Bkgs</th>
                      <th className="px-3 py-3 text-right bg-blue-50/50">F.Contrib%</th>
                      <th className="px-3 py-3 text-right border-l border-green-200 bg-green-50/50">Finance Rev</th>
                      <th className="px-3 py-3 text-right bg-green-50/50">Trips</th>
                      <th className="px-3 py-3 text-right bg-green-50/50">Fin.Contrib%</th>
                      <th className="px-3 py-3 text-right border-l border-gray-200">Gap</th>
                      <th className="px-3 py-3 text-right">Conv%</th>
                      <th className="px-3 py-3 text-right border-l border-amber-200 bg-amber-50/30">Credit Rev</th>
                      <th className="px-3 py-3 text-right bg-amber-50/30">Credit%</th>
                      <th className="px-3 py-3 text-right border-l border-green-200 bg-green-50/30">Direct Rev</th>
                      <th className="px-3 py-3 text-right bg-green-50/30">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {hospitalAgg.slice(0, 100).map((h, i) => {
                      const creditPct = h.financeRev > 0 ? (h.financeBillToClient / h.financeRev * 100) : 0;
                      return (
                        <tr key={h.hospital} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition`}>
                          <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[250px] truncate sticky left-0 bg-inherit" title={h.hospital}>{h.hospital}</td>
                          <td className="px-3 py-2.5 text-gray-600">{CITY_NAMES[h.city] || h.city}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${h.health.bg} ${h.health.text} ${h.health.border} border`}>
                              {h.health.emoji} {h.health.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right border-l border-blue-100 font-medium">{fmtR(h.funnelRev)}</td>
                          <td className="px-3 py-2.5 text-right">{fmt(h.funnelBookings)}</td>
                          <td className="px-3 py-2.5 text-right text-blue-600">{pct(h.funnelContrib)}</td>
                          <td className="px-3 py-2.5 text-right border-l border-green-100 font-medium">{fmtR(h.financeRev)}</td>
                          <td className="px-3 py-2.5 text-right">{fmt(h.financeTrips)}</td>
                          <td className="px-3 py-2.5 text-right text-green-600">{pct(h.financeContrib)}</td>
                          <td className="px-3 py-2.5 text-right border-l border-gray-200">
                            <span className={h.variance > 0 ? 'text-red-600' : 'text-green-600'}>{fmtR(h.variance)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={h.conversionPct >= 80 ? 'text-green-600 font-medium' : h.conversionPct >= 60 ? 'text-amber-600' : 'text-red-600'}>{pct(h.conversionPct)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right border-l border-amber-100">{fmtR(h.financeBillToClient)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={creditPct > 60 ? 'text-red-600 font-medium' : creditPct > 30 ? 'text-amber-600' : 'text-green-600'}>{pct(creditPct)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right border-l border-green-100 text-green-700">{fmtR(h.financeDirectPay)}</td>
                          <td className="px-3 py-2.5 text-right">{fmtR(h.financeMargin)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 border-t">
                Showing top {Math.min(hospitalAgg.length, 100)} of {hospitalAgg.length} hospitals
              </div>
            </div>
          </div>
        )}

        {/* SECTION: Variance & Leakage (Step 7) */}
        {activeSection === 'variance' && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Funnel vs Finance Variance Analysis</h2>

            {/* Top Leakage Hospitals */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="text-sm font-semibold text-red-700 mb-4">Top Revenue Leakage (Funnel &gt; Finance)</h3>
              <div className="space-y-3">
                {hospitalAgg.filter(h => h.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 15).map((h, i) => {
                  const barWidth = hospitalAgg.length > 0 ? (h.variance / Math.max(...hospitalAgg.filter(x => x.variance > 0).map(x => x.variance))) * 100 : 0;
                  return (
                    <div key={h.hospital} className="flex items-center gap-3">
                      <div className="w-6 text-xs text-gray-400 text-right">{i + 1}</div>
                      <div className="w-[250px] truncate text-xs font-medium text-gray-700" title={h.hospital}>{h.hospital}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                        <div className="bg-red-400 rounded-full h-4" style={{ width: `${barWidth}%` }}></div>
                      </div>
                      <div className="w-[100px] text-right text-xs font-medium text-red-600">{fmtR(h.variance)}</div>
                      <div className="w-[60px] text-right text-xs text-gray-500">{pct(h.conversionPct)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Over-performing (Finance > Funnel, negative variance) */}
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h3 className="text-sm font-semibold text-green-700 mb-4">Over-performing (Finance &ge; Funnel)</h3>
              <div className="space-y-3">
                {hospitalAgg.filter(h => h.variance <= 0).sort((a, b) => a.variance - b.variance).slice(0, 10).map((h, i) => {
                  const absVar = Math.abs(h.variance);
                  const maxAbsVar = Math.max(...hospitalAgg.filter(x => x.variance <= 0).map(x => Math.abs(x.variance)), 1);
                  const barWidth = (absVar / maxAbsVar) * 100;
                  return (
                    <div key={h.hospital} className="flex items-center gap-3">
                      <div className="w-6 text-xs text-gray-400 text-right">{i + 1}</div>
                      <div className="w-[250px] truncate text-xs font-medium text-gray-700" title={h.hospital}>{h.hospital}</div>
                      <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                        <div className="bg-green-400 rounded-full h-4" style={{ width: `${barWidth}%` }}></div>
                      </div>
                      <div className="w-[100px] text-right text-xs font-medium text-green-600">+{fmtR(absVar)}</div>
                      <div className="w-[60px] text-right text-xs text-gray-500">{pct(h.conversionPct)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SECTION: Strategic Insights (Steps 10, 11) */}
        {activeSection === 'insights' && totals && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Business Insights & Recommendations</h2>

            <InsightsPanel totals={totals} hospitalAgg={hospitalAgg} providerAgg={providerAgg} />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function CashBucket({ title, subtitle, amount, totalRef, color, icon, detail }) {
  const pctOfTotal = totalRef > 0 ? ((amount / totalRef) * 100).toFixed(1) : 0;
  const colorMap = { green: 'border-green-200 bg-green-50', blue: 'border-blue-200 bg-blue-50', amber: 'border-amber-200 bg-amber-50' };
  const textMap = { green: 'text-green-700', blue: 'text-blue-700', amber: 'text-amber-700' };
  return (
    <div className={`rounded-xl border-2 ${colorMap[color]} p-5`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <h3 className={`font-semibold text-sm ${textMap[color]}`}>{title}</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">{subtitle}</p>
      <p className={`text-2xl font-bold ${textMap[color]}`}>{fmtR(amount)}</p>
      <p className="text-xs text-gray-500 mt-1">{pctOfTotal}% of total</p>
      {detail && <p className="text-xs text-gray-400 mt-1">{detail}</p>}
    </div>
  );
}

function FinancialViewCard({ title, icon, iconColor, totalRev, totalVolume, volumeLabel, margin, directPay, billToClient }) {
  const marginPct = totalRev > 0 ? (margin / totalRev * 100) : 0;
  const directPct = totalRev > 0 ? (directPay / totalRev * 100) : 0;
  const creditPct = totalRev > 0 ? (billToClient / totalRev * 100) : 0;
  const borderColor = iconColor === 'blue' ? 'border-l-blue-400' : 'border-l-green-400';
  const iconBg = iconColor === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-l-4 ${borderColor} p-5`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${iconBg}`}>{icon}</span>
        <h3 className="font-semibold text-sm text-gray-900">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MiniMetric label="Total Revenue" value={fmtR(totalRev)} />
        <MiniMetric label={volumeLabel} value={fmt(totalVolume)} />
        <MiniMetric label="Margin" value={fmtR(margin)} sub={pct(marginPct)} />
        <div>
          <div className="text-xs text-gray-600 font-medium">Cash Split</div>
          <div className="mt-1 flex gap-1 h-3 rounded-full overflow-hidden bg-gray-100">
            <div className="bg-green-500 rounded-l-full" style={{ width: `${directPct}%` }} title={`Direct: ${pct(directPct)}`}></div>
            <div className="bg-amber-400 rounded-r-full" style={{ width: `${creditPct}%` }} title={`Credit: ${pct(creditPct)}`}></div>
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-green-600">Direct {pct(directPct)}</span>
            <span className="text-amber-600">Credit {pct(creditPct)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, sub, color = 'text-gray-900' }) {
  return (
    <div>
      <div className="text-xs text-gray-600 font-medium">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function InsightsPanel({ totals, hospitalAgg, providerAgg }) {
  // Cash vs Revenue drivers
  const topCashHospitals = [...hospitalAgg].sort((a, b) => b.financeDirectPay - a.financeDirectPay).slice(0, 5);
  const topCreditHospitals = [...hospitalAgg].sort((a, b) => b.financeBillToClient - a.financeBillToClient).slice(0, 5);
  const highRiskHospitals = hospitalAgg.filter(h => h.health.label === 'High Risk');
  const stuckRevenue = hospitalAgg.reduce((s, h) => s + Math.max(h.variance, 0), 0);
  const creditTotal = hospitalAgg.reduce((s, h) => s + h.financeBillToClient, 0);

  // Provider efficiency
  const bestProvider = providerAgg.length > 0 ? [...providerAgg].sort((a, b) => {
    const aConv = a.funnelRev > 0 ? a.financeRev / a.funnelRev : 0;
    const bConv = b.funnelRev > 0 ? b.financeRev / b.funnelRev : 0;
    return bConv - aConv;
  })[0] : null;

  return (
    <div className="space-y-4">
      {/* Key Risks */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-5">
        <h3 className="font-semibold text-sm text-red-800 mb-3">Key Risks Identified</h3>
        <div className="space-y-2 text-xs text-red-700">
          <p><strong>Revenue Leakage:</strong> {fmtR(stuckRevenue)} of funnel revenue has not converted to finance. This represents bookings that were made but not yet delivered/fulfilled.</p>
          <p><strong>Credit Exposure:</strong> {fmtR(creditTotal)} ({totals.totalFinance > 0 ? pct(creditTotal / totals.totalFinance * 100) : '0%'}) of finance revenue is billed to hospitals (credit). This cash is at risk of delayed collection.</p>
          {highRiskHospitals.length > 0 && (
            <p><strong>High Risk Hospitals:</strong> {highRiskHospitals.length} hospitals flagged as high risk: {highRiskHospitals.slice(0, 5).map(h => h.hospital).join(', ')}{highRiskHospitals.length > 5 ? ` (+${highRiskHospitals.length - 5} more)` : ''}</p>
          )}
        </div>
      </div>

      {/* Who drives cash vs just visibility */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <h3 className="font-semibold text-sm text-green-800 mb-3">Top Cash-Generating Hospitals</h3>
          <p className="text-xs text-green-700 mb-2">These hospitals drive actual near-term cash inflow (direct patient payment):</p>
          <div className="space-y-2">
            {topCashHospitals.map((h, i) => (
              <div key={h.hospital} className="flex justify-between items-center text-xs">
                <span className="text-gray-700 truncate max-w-[200px]" title={h.hospital}>{i + 1}. {h.hospital}</span>
                <span className="font-medium text-green-700">{fmtR(h.financeDirectPay)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="font-semibold text-sm text-amber-800 mb-3">Top Credit-Heavy Hospitals</h3>
          <p className="text-xs text-amber-700 mb-2">Revenue is visible but cash is delayed (billed to hospital):</p>
          <div className="space-y-2">
            {topCreditHospitals.map((h, i) => (
              <div key={h.hospital} className="flex justify-between items-center text-xs">
                <span className="text-gray-700 truncate max-w-[200px]" title={h.hospital}>{i + 1}. {h.hospital}</span>
                <span className="font-medium text-amber-700">{fmtR(h.financeBillToClient)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider efficiency */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h3 className="font-semibold text-sm text-blue-800 mb-3">Provider Type Efficiency</h3>
        <div className="space-y-2 text-xs text-blue-700">
          {providerAgg.map(p => {
            const conv = p.funnelRev > 0 ? (p.financeRev / p.funnelRev * 100) : 0;
            const cashRatio = p.financeRev > 0 ? (p.financeDirectPay / p.financeRev * 100) : 0;
            return (
              <div key={p.provider} className="flex items-center gap-4">
                <span className="w-24 font-medium">{PROVIDER_LABELS[p.provider] || p.provider}</span>
                <span>Conv: {pct(conv)}</span>
                <span>Cash Ratio: {pct(cashRatio)}</span>
                <span>Margin: {fmtR(p.financeMargin)}</span>
                <span className={conv >= 80 && cashRatio >= 50 ? 'text-green-700 font-medium' : conv < 60 ? 'text-red-700 font-medium' : 'text-amber-700'}>
                  {conv >= 80 && cashRatio >= 50 ? 'Efficient' : conv < 60 ? 'Needs Attention' : 'Moderate'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strategic Recommendations */}
      <div className="bg-white border rounded-xl shadow-sm p-5">
        <h3 className="font-semibold text-sm text-gray-900 mb-3">Strategic Recommendations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-gray-700 mb-1">Improve Cash Flow</h4>
            <p className="text-gray-600">Focus on converting the {fmtR(stuckRevenue)} pipeline gap. Prioritize hospitals with high funnel revenue but low finance conversion. Consider prepayment incentives for bill-to-client hospitals.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-gray-700 mb-1">Reduce Credit Exposure</h4>
            <p className="text-gray-600">{fmtR(creditTotal)} sits in credit. Target hospitals with &gt;60% credit ratio for payment term renegotiation. Introduce early-payment discounts or shift to patient-pay models where possible.</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-gray-700 mb-1">Optimize Provider Mix</h4>
            <p className="text-gray-600">
              {bestProvider ? `${PROVIDER_LABELS[bestProvider.provider] || bestProvider.provider} shows the highest conversion efficiency.` : 'Analyze provider mix.'}
              {' '}Increase allocation to providers with high conversion and low credit mix. Reduce dependency on providers with high revenue gap.
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-gray-700 mb-1">Immediate Actions</h4>
            <p className="text-gray-600">
              1. Follow up on {highRiskHospitals.length} high-risk hospitals immediately.
              {' '}2. Review {hospitalAgg.filter(h => h.conversionPct < 60 && h.funnelRev > 10000).length} hospitals with &lt;60% conversion and significant funnel revenue.
              {' '}3. Negotiate credit terms with top credit-heavy partners.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
