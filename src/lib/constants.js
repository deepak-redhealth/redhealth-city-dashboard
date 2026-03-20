// RED.Health Locked Logic Constants — v8 Final
export const ORG_ID = '14927ff8-a1f6-49ba-abcb-7bb1cf842d52';

// Zone → City mapping (discovered from Snowflake data, Mar 2026)
export const ZONE_CITY_MAP = {
  South: ['HYD', 'BLR', 'CHN'],
  East: ['KOL', 'BBS', 'PAT', 'RNC', 'GKP'],
  North: ['DLH', 'GGN', 'NOI', 'LCK', 'KNP', 'MOHL', 'GHT', 'JPR', 'CHGL'],
  West: ['MUM', 'AMD', 'IDR', 'NGP', 'SGU', 'BLG', 'FDB', 'PCK', 'NMB', 'VIPU', 'PNE'],
};

// City display names
export const CITY_NAMES = {
  HYD: 'Hyderabad', KOL: 'Kolkata', DLH: 'Delhi', GGN: 'Gurugram',
  MUM: 'Mumbai', BLR: 'Bengaluru', PAT: 'Patna', LCK: 'Lucknow',
  MOHL: 'Mohali', KNP: 'Kanpur', SGU: 'Siliguri', BBS: 'Bhubaneswar',
  CHN: 'Chennai', NOI: 'Noida', IDR: 'Indore', GHT: 'Guwahati',
  BLG: 'Belgaum', AMD: 'Ahmedabad', NGP: 'Nagpur', PCK: 'Panchkula',
  FDB: 'Faridabad', RNC: 'Ranchi', JPR: 'Jaipur', NMB: 'Navi Mumbai',
  GKP: 'Gorakhpur', VIPU: 'Visakhapatnam', PNE: 'Pune', CHGL: 'Chandigarh',
};

// Monthly Targets (March 2026)
export const TARGETS = {
  Hospital: { revenue_cr: 5.05, cancel_pct: 12 },
  'Stan Command': { revenue_cr: 0.55, cancel_pct: 15 },
  Digital: { revenue_cr: 1.00, cancel_pct: 20 },
  road_total_cr: 6.50,
  air_ambulance_cr: 2.60,
  grand_total_cr: 9.10,
  margin_pct: 28,
  own_vehicle_pct: 55,
  dqr_pct: 35,
};

// Compute IST dates for dashboard — MTD till today, compare today vs yesterday
export function getDateRange() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  const today = new Date(istNow);
  const yesterday = new Date(istNow);
  yesterday.setDate(yesterday.getDate() - 1);

  const mtdStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const fmt = (d) => d.toISOString().split('T')[0];

  return {
    mtdStart: fmt(mtdStart),
    mtdEnd: fmt(today),        // MTD includes today
    today: fmt(today),          // today's snapshot
    yesterday: fmt(yesterday),  // comparison day
    reportDate: today.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    }),
    monthName: today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
  };
}
