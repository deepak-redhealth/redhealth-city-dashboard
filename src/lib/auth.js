// ============================================================
// AUTH LIBRARY - Session, Password, IP tracking
// ============================================================
import { executeQuery } from '@/lib/snowflake';
import crypto from 'crypto';

// --- Password Hashing (SHA-256 + salt, no external deps) ---
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || storedHash === 'CHANGE_ON_FIRST_LOGIN') return false;
  const [salt] = storedHash.split(':');
  return hashPassword(password, salt) === storedHash;
}

export function createPasswordHash(password) {
  return hashPassword(password);
}

// --- Session Management ---
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(email, ip) {
  const token = generateSessionToken();
  const expiresHours = 24;
  await executeQuery(`
    INSERT INTO BLADE.CORE.DASHBOARD_SESSIONS (USER_EMAIL, SESSION_TOKEN, IP_ADDRESS, EXPIRES_AT)
    SELECT '${email}', '${token}', '${ip}', DATEADD('hour', ${expiresHours}, CURRENT_TIMESTAMP())
  `);
  return token;
}

export async function validateSession(token) {
  if (!token) return null;
  const rows = await executeQuery(`
    SELECT s.USER_EMAIL, s.IP_ADDRESS, s.EXPIRES_AT, s.IS_ACTIVE,
           u.NAME, u.ROLE, u.ACCESS_LEVEL, u.ALLOWED_ZONES, u.ALLOWED_CITIES, u.ALLOWED_ENDPOINTS, u.IS_ACTIVE AS USER_ACTIVE
    FROM BLADE.CORE.DASHBOARD_SESSIONS s
    JOIN BLADE.CORE.DASHBOARD_USERS u ON LOWER(s.USER_EMAIL) = LOWER(u.EMAIL)
    WHERE s.SESSION_TOKEN = '${token}'
      AND s.IS_ACTIVE = TRUE
      AND s.EXPIRES_AT > CURRENT_TIMESTAMP()
    LIMIT 1
  `);
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  if (!r.USER_ACTIVE) return null;
  return {
    email: r.USER_EMAIL,
    name: r.NAME,
    role: r.ROLE,
    accessLevel: r.ACCESS_LEVEL,
    allowedZones: r.ALLOWED_ZONES ? (typeof r.ALLOWED_ZONES === 'string' ? JSON.parse(r.ALLOWED_ZONES) : r.ALLOWED_ZONES) : null,
    allowedCities: r.ALLOWED_CITIES ? (typeof r.ALLOWED_CITIES === 'string' ? JSON.parse(r.ALLOWED_CITIES) : r.ALLOWED_CITIES) : null,
    allowedEndpoints: r.ALLOWED_ENDPOINTS ? (typeof r.ALLOWED_ENDPOINTS === 'string' ? JSON.parse(r.ALLOWED_ENDPOINTS) : r.ALLOWED_ENDPOINTS) : null,
  };
}

export async function destroySession(token) {
  await executeQuery(`
    UPDATE BLADE.CORE.DASHBOARD_SESSIONS SET IS_ACTIVE = FALSE WHERE SESSION_TOKEN = '${token}'
  `);
}

// --- IP Tracking ---
export async function checkAndTrackIP(email, ip) {
  // Get current IP count for this user
  const existing = await executeQuery(`
    SELECT IP_ADDRESS FROM BLADE.CORE.DASHBOARD_IP_TRACKING
    WHERE LOWER(USER_EMAIL) = LOWER('${email}')
    ORDER BY FIRST_SEEN
  `);

  const knownIPs = existing.map(r => r.IP_ADDRESS);

  // If this IP is already known, just update LAST_SEEN
  if (knownIPs.includes(ip)) {
    await executeQuery(`
      UPDATE BLADE.CORE.DASHBOARD_IP_TRACKING
      SET LAST_SEEN = CURRENT_TIMESTAMP()
      WHERE LOWER(USER_EMAIL) = LOWER('${email}') AND IP_ADDRESS = '${ip}'
    `);
    return { allowed: true, ipCount: knownIPs.length, knownIPs };
  }

  // New IP — check if already at limit (3)
  if (knownIPs.length >= 3) {
    return { allowed: false, ipCount: knownIPs.length, knownIPs, blocked: true };
  }

  // Register new IP
  await executeQuery(`
    INSERT INTO BLADE.CORE.DASHBOARD_IP_TRACKING (USER_EMAIL, IP_ADDRESS)
    SELECT '${email}', '${ip}'
  `);
  return { allowed: true, ipCount: knownIPs.length + 1, knownIPs: [...knownIPs, ip] };
}

// --- Get user by email ---
export async function getUserByEmail(email) {
  const rows = await executeQuery(`
    SELECT EMAIL, PASSWORD_HASH, NAME, ROLE, ACCESS_LEVEL,
           ALLOWED_ZONES, ALLOWED_CITIES, ALLOWED_ENDPOINTS, IS_ACTIVE
    FROM BLADE.CORE.DASHBOARD_USERS
    WHERE LOWER(EMAIL) = LOWER('${email}')
    LIMIT 1
  `);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// --- Resolve cities from access level ---
export async function resolveCities(user) {
  if (!user) return [];
  // Admin / overall = all cities
  if (user.role === 'admin' || user.accessLevel === 'overall' || user.ACCESS_LEVEL === 'overall') {
    return null; // null = all cities
  }
  // Zone-level: expand zones to cities
  const accessLevel = user.accessLevel || user.ACCESS_LEVEL;
  const allowedZones = user.allowedZones || user.ALLOWED_ZONES;
  const allowedCities = user.allowedCities || user.ALLOWED_CITIES;

  if (accessLevel === 'zone' && allowedZones) {
    const zones = typeof allowedZones === 'string' ? JSON.parse(allowedZones) : allowedZones;
    if (zones.length > 0) {
      const zoneList = zones.map(z => `'${z}'`).join(',');
      const rows = await executeQuery(`
        SELECT CITY_NAME FROM BLADE.CORE.DASHBOARD_ZONE_MAPPING WHERE ZONE_NAME IN (${zoneList})
      `);
      return rows.map(r => r.CITY_NAME);
    }
  }
  // City-level: return direct city list
  if (allowedCities) {
    const cities = typeof allowedCities === 'string' ? JSON.parse(allowedCities) : allowedCities;
    return cities;
  }
  return [];
}
