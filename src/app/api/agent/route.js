import { NextResponse } from 'next/server';
import { executeQuery } from '@/lib/snowflake';
import { buildAgentQuery } from '@/lib/queries';
import { getDateRange } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const dates = getDateRange();
    const mtdStart = searchParams.get('start') || dates.mtdStart;
    const mtdEnd = searchParams.get('end') || dates.mtdEnd;
    const today = searchParams.get('today') || dates.today;
    const yesterday = searchParams.get('yesterday') || dates.yesterday;

    const sql = buildAgentQuery(mtdStart, mtdEnd, today, yesterday);
    const rows = await executeQuery(sql);

    return NextResponse.json({
      data: rows,
      dates: { mtdStart, mtdEnd, today, yesterday, reportDate: dates.reportDate, monthName: dates.monthName },
    });
  } catch (error) {
    console.error('Agent API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
