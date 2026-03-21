import { NextResponse } from 'next/server';
import { executeQuery } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const { userEmail, userName, userRole, action, citiesViewed } = body;

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    const sql = `
      INSERT INTO BLADE.CORE.DASHBOARD_ACCESS_LOG
        (USER_EMAIL, USER_NAME, USER_ROLE, ACTION, CITIES_VIEWED, IP_ADDRESS, USER_AGENT, ACCESS_TIMESTAMP)
      VALUES
        ('${(userEmail || '').replace(/'/g, "''")}',
         '${(userName || '').replace(/'/g, "''")}',
         '${(userRole || '').replace(/'/g, "''")}',
         '${(action || 'page_load').replace(/'/g, "''")}',
         '${(citiesViewed || '').replace(/'/g, "''")}',
         '${ip.replace(/'/g, "''")}',
         '${ua.substring(0, 500).replace(/'/g, "''")}',
         CONVERT_TIMEZONE('UTC','Asia/Kolkata',CURRENT_TIMESTAMP()))
    `;

    await executeQuery(sql);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Log API error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// GET endpoint to retrieve logs (admin only)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);

    const sql = `
      SELECT USER_EMAIL, USER_NAME, USER_ROLE, ACTION,
             CITIES_VIEWED, IP_ADDRESS, ACCESS_TIMESTAMP
      FROM BLADE.CORE.DASHBOARD_ACCESS_LOG
      WHERE ACCESS_TIMESTAMP >= DATEADD(day, -${days}, CURRENT_TIMESTAMP())
      ORDER BY ACCESS_TIMESTAMP DESC
      LIMIT 500
    `;

    const rows = await executeQuery(sql);

    // Summary: count refreshes per user
    const summary = {};
    rows.forEach(r => {
      const key = r.USER_EMAIL || 'unknown';
      if (!summary[key]) summary[key] = { email: key, name: r.USER_NAME, role: r.USER_ROLE, count: 0, lastAccess: null };
      summary[key].count++;
      if (!summary[key].lastAccess) summary[key].lastAccess = r.ACCESS_TIMESTAMP;
    });

    return NextResponse.json({
      logs: rows,
      summary: Object.values(summary),
      totalViews: rows.length,
      periodDays: days
    });
  } catch (error) {
    console.error('Log GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
