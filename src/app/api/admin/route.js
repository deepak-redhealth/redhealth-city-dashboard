import { NextResponse } from 'next/server';
import { validateSession, createPasswordHash } from '@/lib/auth';
import { executeQuery } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

// Admin-only middleware check
async function requireAdmin(request) {
  const token = request.headers.get('x-session-token') ||
    new URL(request.url).searchParams.get('token');
  const session = await validateSession(token);
  if (!session || session.role !== 'admin') return null;
  return session;
}

// GET = list users, IP tracking, zone mappings
export async function GET(request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'users') {
      const rows = await executeQuery(`
        SELECT ID, EMAIL, NAME, ROLE, ACCESS_LEVEL, ALLOWED_ZONES, ALLOWED_CITIES,
               ALLOWED_ENDPOINTS, ALLOWED_LOBS, IS_ACTIVE, CREATED_AT, UPDATED_AT
        FROM BLADE.CORE.DASHBOARD_USERS ORDER BY ROLE, NAME
      `);
      return NextResponse.json({ users: rows });
    }

    if (action === 'ips') {
      const email = searchParams.get('email');
      const where = email ? `WHERE LOWER(USER_EMAIL) = LOWER('${email}')` : '';
      const rows = await executeQuery(`
        SELECT USER_EMAIL, IP_ADDRESS, FIRST_SEEN, LAST_SEEN, IS_BLOCKED
        FROM BLADE.CORE.DASHBOARD_IP_TRACKING ${where}
        ORDER BY USER_EMAIL, FIRST_SEEN
      `);
      return NextResponse.json({ ips: rows });
    }

    if (action === 'zones') {
      const rows = await executeQuery(`
        SELECT ZONE_NAME, CITY_NAME FROM BLADE.CORE.DASHBOARD_ZONE_MAPPING ORDER BY ZONE_NAME, CITY_NAME
      `);
      return NextResponse.json({ zones: rows });
    }

    if (action === 'sessions') {
      const rows = await executeQuery(`
        SELECT USER_EMAIL, IP_ADDRESS, CREATED_AT, EXPIRES_AT, IS_ACTIVE
        FROM BLADE.CORE.DASHBOARD_SESSIONS
        WHERE IS_ACTIVE = TRUE AND EXPIRES_AT > CURRENT_TIMESTAMP()
        ORDER BY CREATED_AT DESC LIMIT 50
      `);
      return NextResponse.json({ sessions: rows });
    }

    // Default: return all info
    const users = await executeQuery(`SELECT ID, EMAIL, NAME, ROLE, ACCESS_LEVEL, IS_ACTIVE FROM BLADE.CORE.DASHBOARD_USERS ORDER BY ROLE, NAME`);
    const ips = await executeQuery(`SELECT USER_EMAIL, IP_ADDRESS, FIRST_SEEN, LAST_SEEN FROM BLADE.CORE.DASHBOARD_IP_TRACKING ORDER BY USER_EMAIL`);
    return NextResponse.json({ users, ips });
  } catch (error) {
    console.error('Admin GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST = admin actions (add user, reset IPs, toggle active, update access)
export async function POST(request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const body = await request.json();
    const { action } = body;

    // --- RESET IPs for a user ---
    if (action === 'reset-ips') {
      const { email } = body;
      if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });
      await executeQuery(`DELETE FROM BLADE.CORE.DASHBOARD_IP_TRACKING WHERE LOWER(USER_EMAIL) = LOWER('${email}')`);
      // Also kill active sessions so they re-login from a fresh IP
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_SESSIONS SET IS_ACTIVE = FALSE WHERE LOWER(USER_EMAIL) = LOWER('${email}')`);
      return NextResponse.json({ success: true, message: `IPs reset for ${email}` });
    }

    // --- ADD USER ---
    if (action === 'add-user') {
      const { email, name, role, accessLevel, allowedZones, allowedCities, allowedEndpoints, allowedLobs } = body;
      if (!email || !name || !role) return NextResponse.json({ error: 'email, name, role required' }, { status: 400 });

      const zones = allowedZones ? `PARSE_JSON('${JSON.stringify(allowedZones)}')` : 'NULL';
      const cities = allowedCities ? `PARSE_JSON('${JSON.stringify(allowedCities)}')` : 'NULL';
      const endpoints = allowedEndpoints
        ? `PARSE_JSON('${JSON.stringify(allowedEndpoints)}')`
        : `PARSE_JSON('["funnel","finance","agent","hospital","agent-finance","hospital-finance","finance-analytics-funnel","finance-analytics-finance","coll-lob","coll-summary","coll-hospital","coll-partner","coll-employee","coll-trend","coll-ageing","coll-b2h","coll-raw"]')`;
      const lobs = allowedLobs ? `PARSE_JSON('${JSON.stringify(allowedLobs)}')` : 'NULL';

      await executeQuery(`
        INSERT INTO BLADE.CORE.DASHBOARD_USERS (EMAIL, PASSWORD_HASH, NAME, ROLE, ACCESS_LEVEL, ALLOWED_ZONES, ALLOWED_CITIES, ALLOWED_ENDPOINTS, ALLOWED_LOBS)
        SELECT '${email}', 'CHANGE_ON_FIRST_LOGIN', '${name}', '${role}', '${accessLevel || 'city'}', ${zones}, ${cities}, ${endpoints}, ${lobs}
      `);
      return NextResponse.json({ success: true, message: `User ${email} added` });
    }

    // --- REMOVE USER ---
    if (action === 'remove-user') {
      const { email } = body;
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_USERS SET IS_ACTIVE = FALSE WHERE LOWER(EMAIL) = LOWER('${email}')`);
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_SESSIONS SET IS_ACTIVE = FALSE WHERE LOWER(USER_EMAIL) = LOWER('${email}')`);
      return NextResponse.json({ success: true, message: `User ${email} disabled` });
    }

    // --- REACTIVATE USER ---
    if (action === 'activate-user') {
      const { email } = body;
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_USERS SET IS_ACTIVE = TRUE WHERE LOWER(EMAIL) = LOWER('${email}')`);
      return NextResponse.json({ success: true, message: `User ${email} activated` });
    }

    // --- UPDATE ACCESS ---
    if (action === 'update-access') {
      const { email, role, accessLevel, allowedZones, allowedCities, allowedEndpoints, allowedLobs } = body;
      if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

      const sets = [];
      if (role) sets.push(`ROLE = '${role}'`);
      if (accessLevel) sets.push(`ACCESS_LEVEL = '${accessLevel}'`);
      if (allowedZones !== undefined) sets.push(`ALLOWED_ZONES = ${allowedZones ? `PARSE_JSON('${JSON.stringify(allowedZones)}')` : 'NULL'}`);
      if (allowedCities !== undefined) sets.push(`ALLOWED_CITIES = ${allowedCities ? `PARSE_JSON('${JSON.stringify(allowedCities)}')` : 'NULL'}`);
      if (allowedEndpoints !== undefined) sets.push(`ALLOWED_ENDPOINTS = ${allowedEndpoints ? `PARSE_JSON('${JSON.stringify(allowedEndpoints)}')` : 'NULL'}`);
      if (allowedLobs !== undefined) sets.push(`ALLOWED_LOBS = ${allowedLobs ? `PARSE_JSON('${JSON.stringify(allowedLobs)}')` : 'NULL'}`);
      sets.push(`UPDATED_AT = CURRENT_TIMESTAMP()`);

      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_USERS SET ${sets.join(', ')} WHERE LOWER(EMAIL) = LOWER('${email}')`);
      return NextResponse.json({ success: true, message: `Access updated for ${email}` });
    }

    // --- RESET PASSWORD ---
    if (action === 'reset-password') {
      const { email } = body;
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_USERS SET PASSWORD_HASH = 'CHANGE_ON_FIRST_LOGIN', UPDATED_AT = CURRENT_TIMESTAMP() WHERE LOWER(EMAIL) = LOWER('${email}')`);
      await executeQuery(`UPDATE BLADE.CORE.DASHBOARD_SESSIONS SET IS_ACTIVE = FALSE WHERE LOWER(USER_EMAIL) = LOWER('${email}')`);
      return NextResponse.json({ success: true, message: `Password reset for ${email}. User must set new password on next login.` });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Admin POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
