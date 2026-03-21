import { NextResponse } from 'next/server';
import { getUserByEmail, verifyPassword, createPasswordHash, checkAndTrackIP, createSession, validateSession, destroySession } from '@/lib/auth';
import { executeQuery } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

// GET = validate session
export async function GET(request) {
  try {
    const token = request.headers.get('x-session-token') ||
      new URL(request.url).searchParams.get('token');
    if (!token) return NextResponse.json({ authenticated: false }, { status: 401 });

    const session = await validateSession(token);
    if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });

    return NextResponse.json({ authenticated: true, user: session });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST = login or set-password or logout
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') || '0.0.0.0';

    if (action === 'logout') {
      const token = body.token;
      if (token) await destroySession(token);
      return NextResponse.json({ success: true });
    }

    if (action === 'set-password') {
      const { email, newPassword, token } = body;
      // Verify admin session or self-service for CHANGE_ON_FIRST_LOGIN
      const session = token ? await validateSession(token) : null;
      const user = await getUserByEmail(email);
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

      // Allow if: admin session, or password is CHANGE_ON_FIRST_LOGIN (first-time setup)
      const isAdmin = session && session.role === 'admin';
      const isFirstLogin = user.PASSWORD_HASH === 'CHANGE_ON_FIRST_LOGIN';

      if (!isAdmin && !isFirstLogin) {
        return NextResponse.json({ error: 'Not authorized to change password' }, { status: 403 });
      }

      const hash = createPasswordHash(newPassword);
      await executeQuery(`
        UPDATE BLADE.CORE.DASHBOARD_USERS
        SET PASSWORD_HASH = '${hash}', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE LOWER(EMAIL) = LOWER('${email}')
      `);
      return NextResponse.json({ success: true, message: 'Password set successfully' });
    }

    // Default: login
    const { email, password } = body;
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    if (!user) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    if (!user.IS_ACTIVE) return NextResponse.json({ error: 'Account is disabled' }, { status: 403 });

    // Check if first-time login (needs password setup)
    if (user.PASSWORD_HASH === 'CHANGE_ON_FIRST_LOGIN') {
      return NextResponse.json({ needsPasswordSetup: true, email }, { status: 200 });
    }

    // Verify password
    if (!verifyPassword(password, user.PASSWORD_HASH)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check IP tracking
    const ipCheck = await checkAndTrackIP(email, ip);
    if (!ipCheck.allowed) {
      return NextResponse.json({
        error: 'Too many devices. Your account has been accessed from 3 different IPs. Contact admin to reset.',
        ipCount: ipCheck.ipCount,
        blocked: true
      }, { status: 403 });
    }

    // Create session
    const token = await createSession(email, ip);

    return NextResponse.json({
      success: true,
      token,
      user: {
        email: user.EMAIL,
        name: user.NAME,
        role: user.ROLE,
        accessLevel: user.ACCESS_LEVEL,
      },
      ipInfo: { currentCount: ipCheck.ipCount, limit: 3 }
    });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
