import { NextResponse } from 'next/server';
import { validateSession, resolveCities } from '@/lib/auth';
import { executeQuery } from '@/lib/snowflake';
import { buildFunnelQuery, buildFinanceQuery, buildAgentQuery, buildHospitalQuery, buildAgentFinanceQuery, buildHospitalFinanceQuery, buildFinanceAnalyticsFunnelQuery, buildFinanceAnalyticsFinanceQuery } from '@/lib/queries';
import {
  buildCollectionsLOBSummaryQuery,
  buildCollectionsSummaryQuery,
  buildCollectionsHospitalQuery,
  buildCollectionsPartnerQuery,
  buildCollectionsEmployeeQuery,
  buildCollectionsTrendQuery,
  buildCollectionsAgeingDetailQuery,
  buildCollectionsB2HSummaryQuery,
  buildCollectionsRawReportQuery
} from '@/lib/collection-queries';
import { getDateRange } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── In-memory cache (survives across requests within the same serverless instance) ──
const queryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedOrNull(key) {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // Evict old entries if cache grows too large (prevent memory leak)
  if (queryCache.size > 200) {
    const oldest = [...queryCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 50; i++) queryCache.delete(oldest[i][0]);
  }
  queryCache.set(key, { data, ts: Date.now() });
}

// Single proxy endpoint: /api/data?type=funnel|finance|...|coll-lob|coll-summary|...
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = request.headers.get('x-session-token') || searchParams.get('token');

    // Validate session
    const session = await validateSession(token);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const type = searchParams.get('type');
    if (!type) {
      return NextResponse.json({ error: 'Missing type parameter' }, { status: 400 });
    }

    // Check endpoint permission (collection endpoints allowed for all authenticated users)
    if (session.allowedEndpoints && !type.startsWith('coll-') && !session.allowedEndpoints.includes(type)) {
      return NextResponse.json({ error: 'Access denied to this data type' }, { status: 403 });
    }

    // Resolve cities for this user
    const cities = await resolveCities(session);

    // Get date params
    const dates = getDateRange();
    const mtdStart = searchParams.get('start') || dates.mtdStart;
    const mtdEnd = searchParams.get('end') || dates.mtdEnd;
    const today = searchParams.get('today') || dates.today;
    const yesterday = searchParams.get('yesterday') || dates.yesterday;

    // Collections-specific params
    const startDate = searchParams.get('startDate') || mtdStart;
    const endDate = searchParams.get('endDate') || mtdEnd;
    const dateType = searchParams.get('dateType') || 'txn_created';
    const lob = searchParams.get('lob') || '';
    const cityString = cities !== null ? cities.join(',') : '';

    let sql;
    switch (type) {
      // --- Existing dashboard queries ---
      case 'funnel':
        sql = buildFunnelQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'finance':
        sql = buildFinanceQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'agent':
        sql = buildAgentQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'hospital':
        sql = buildHospitalQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'agent-finance':
        sql = buildAgentFinanceQuery ? buildAgentFinanceQuery(mtdStart, mtdEnd, today, yesterday) : null;
        break;
      case 'hospital-finance':
        sql = buildHospitalFinanceQuery ? buildHospitalFinanceQuery(mtdStart, mtdEnd, today, yesterday) : null;
        break;
      case 'finance-analytics-funnel':
        sql = buildFinanceAnalyticsFunnelQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'finance-analytics-finance':
        sql = buildFinanceAnalyticsFinanceQuery(mtdStart, mtdEnd, today, yesterday);
        break;

      // --- Collections & Payments queries ---
      case 'coll-lob':
        sql = buildCollectionsLOBSummaryQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-summary':
        sql = buildCollectionsSummaryQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-hospital':
        sql = buildCollectionsHospitalQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-partner':
        sql = buildCollectionsPartnerQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-employee':
        sql = buildCollectionsEmployeeQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-trend':
        sql = buildCollectionsTrendQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-ageing':
        sql = buildCollectionsAgeingDetailQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-b2h':
        sql = buildCollectionsB2HSummaryQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-raw':
        sql = buildCollectionsRawReportQuery(startDate, endDate, dateType, lob, cityString);
        break;

      default:
        return NextResponse.json({ error: 'Invalid data type' }, { status: 400 });
    }

    if (!sql) {
      return NextResponse.json({ error: 'Query builder not available for this type' }, { status: 400 });
    }

    // Check cache first (keyed by query type + params)
    const cacheKey = `${type}|${startDate}|${endDate}|${dateType}|${lob}|${cityString}`;
    let rows = getCachedOrNull(cacheKey);
    if (!rows) {
      rows = await executeQuery(sql);
      setCache(cacheKey, rows);
    }

    // Filter by user's allowed cities (server-side enforcement)
    // Skip for collection queries — they already handle city filtering in SQL
    if (!type.startsWith('coll-') && cities !== null && cities.length > 0) {
      const allowed = new Set(cities.map(c => c.toUpperCase()));
      rows = rows.filter(r => {
        const city = (r.CITY || r.CITY_NAME || '').toUpperCase();
        return allowed.has(city);
      });
    }

    return NextResponse.json({
      data: rows,
      dates: { mtdStart, mtdEnd, today, yesterday, reportDate: dates.reportDate, monthName: dates.monthName },
      user: { email: session.email, name: session.name, role: session.role, accessLevel: session.accessLevel }
    });
  } catch (error) {
    console.error('Data proxy error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
