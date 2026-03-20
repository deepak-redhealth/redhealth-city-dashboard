import { NextResponse } from 'next/server';
import { executeQuery } from '@/lib/snowflake';
import { buildFinanceQuery } from '@/lib/queries';
import { getDateRange } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const dates = getDateRange();
    const mtdStart = searchParams.get('start') || dates.mtdStart;
    const mtdEnd = searchParams.get('end') || dates.mtdEnd;
    const dayBefore = searchParams.get('dayBefore') || dates.dayBefore;

    const sql = buildFinanceQuery(mtdStart, mtdEnd, dayBefore);
    const rows = await executeQuery(sql);

    return NextResponse.json({
      data: rows,
      dates: { mtdStart, mtdEnd, dayBefore, reportDate: dates.reportDate, monthName: dates.monthName },
    });
  } catch (error) {
    console.error('Finance API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
