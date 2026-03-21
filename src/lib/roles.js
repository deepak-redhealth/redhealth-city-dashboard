// ============================================================
// ROLE-BASED CITY MAPPING
// Maps user emails to their assigned cities
// cities: null means ALL cities (admin)
// cities: [...] means only those city codes
// ============================================================

export const USERS = {
  // ---- ADMIN ----
  'deepak.k@red.health': {
    name: 'Deepak Kumar',
    role: 'Admin',
    cities: null
  },

  // ---- ZONAL DIRECTORS ----
  'ankit.singh@red.health': {
    name: 'Ankit Singh',
    role: 'Zonal Director',
    cities: [
      'BBS','BLR','HYD','NGP','VIZ','KLM','KNNR','BLG',
      'BWD','CBT','GUL','KOC','MAQ','PRDP','SHI','TNA',
      'VEA','VJA','GAN','GNG','KHAL','KMU','LUR','SHDL'
    ]
  },
  'ritesh.choubey@red.health': {
    name: 'Ritesh Choubey',
    role: 'Zonal Director',
    cities: ['PAT','RNC','LCK','KNP','GKP']
  },

  // ---- CITY HEADS ----
  'satyendra.kumar@red.health': {
    name: 'Satyendra Kumar',
    role: 'City Head',
    cities: ['AMD','DLH','NOI','GGN','GZB','FDB']
  },
  'pushappreet.singh@red.health': {
    name: 'Pushap Preet Singh',
    role: 'City Head',
    cities: ['ASR','CDG','JPR','PCK','MOHL']
  },
  'aditya.mishra@red.health': {
    name: 'Aditya Mishra',
    role: 'City Head',
    cities: ['GHT','KOL','SGU','RAI']
  },
  'saravanan.v@red.health': {
    name: 'Saravanan V',
    role: 'City Head',
    cities: ['CHN','CHGL','VIPU']
  },
  'vivek.tiwari@red.health': {
    name: 'Vivek Tiwari',
    role: 'City Head',
    cities: ['IDR','MUM','NMB','PMC','PNE','VAD']
  }
};

// Helper: get user config by email (case-insensitive)
export function getUserByEmail(email) {
  if (!email) return null;
  const key = email.toLowerCase().trim();
  for (const [k, v] of Object.entries(USERS)) {
    if (k.toLowerCase() === key) return { email: k, ...v };
  }
  return null;
}

// Helper: filter city rows based on user's allowed cities
// If user is admin (cities === null), returns all rows
export function filterByUserCities(rows, user, cityKey = 'CITY') {
  if (!user || user.cities === null) return rows;
  const allowed = new Set(user.cities.map(c => c.toUpperCase()));
  return rows.filter(r => allowed.has((r[cityKey] || '').toUpperCase()));
}

// Helper: get list of all user options for dropdown
export function getUserOptions() {
  return Object.entries(USERS).map(([email, u]) => ({
    email,
    name: u.name,
    role: u.role,
    cityCount: u.cities ? u.cities.length : 'All'
  }));
}
