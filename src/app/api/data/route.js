import { NextResponse } from 'next/server';
import { validateSession, resolveCities } from '@/lib/auth';
import { executeQuery } from '@/lib/snowflake';
import { buildFunnelQuery, buildFinanceQuery, buildAgentQuery, buildHospitalQuery, buildAgentFinanceQuery, buildHospitalFinanceQuery} from '@/lib/queries';
import { buildCollectionsSummaryQuery, buildCollectionsHospitalQuery, buildCollectionsPartnerQuery, buildCollectionsEmployeeQuery, buildCollectionsTrendQuery, buildCollectionsAgeingDetailQuery, buildCollectionsB2HSummaryQuery, buildCollectionsLOBSummaryQuery, buildCollectionsRawReportQuery } from '@/lib/collection-queries';
import { getDateRange } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const token = request.headers.get('x-session-token') || searchParams.get('token');

    const session = await validateSession(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const isCollectionType = type && type.startsWith('coll-');
    const permissionKey = isCollectionType ? 'collections' : type;
    if (session.allowedEndpoints && !session.allowedEndpoints.includes(permissionKey) && session.role !== 'admin') {
      return NextResponse.json({ error: 'Access denied to this data type' }, { status: 403 });
    }

    const cities = await resolveCities(session);
    const cityString = cities ? cities.join(',') : '';

    const { mtdStart, mtdEnd, today, yesterday } = getDateRange();

    // Collection query parameters
    const startDate = searchParams.get('startDate') || mtdStart;
    const endDate = searchParams.get('endDate') || mtdEnd;
    const dateType = searchParams.get('dateType') || 'txn_created';
    const lob = searchParams.get('lob') || '';

    let sql;
    switch (type) {
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
        sql = buildAgentFinanceQuery(mtdStart, mtdEnd, today, yesterday);
        break;
      case 'hospital-finance':
        sql = buildHospitalFinanceQuery(mtdStart, mtdEnd, today, yesterday);
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
      case 'coll-lob':
        sql = buildCollectionsLOBSummaryQuery(startDate, endDate, dateType, lob, cityString);
        break;
      case 'coll-raw':
        sql = buildCollectionsRawReportQuery(startDate, endDate, dateType, lob, cityString);
        break;
      default:
        return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }

    const rows = await executeQuery(sql, isCollectionType ? '' : cityString);
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
