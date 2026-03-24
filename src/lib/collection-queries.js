// Red Health Collections & Payments Dashboard Query Builder
// Snowflake SQL query builder with parameter structure:
// (startDate, endDate, lob, cities)
// Date filter: Terminal account transaction date (payment received at bank)
// Uses TO_TIMESTAMP(TIMESTAMP) from BLADE_TRANSACTIONS_DATA where payment hit
// Red Health / Red Health Finance Admin accounts, converted UTC→IST.
//
// KEY COLUMNS:
// - TOTAL_RECEIVED_IN_BANK: All-time amount received in Red Health terminal accounts for these orders
// - TOTAL_AT_BANK_IN_PERIOD: Amount received at terminal account within the selected date range only
// - PENDING_COLLECTION: Total Red Margin - Total Received in Bank (all-time) — the true net gap
// - PENDING_EMPLOYEE: Wallet internal — current snapshot (B2P orders, OUTSTANDING, non-PARTNER/ADMIN)
// - PENDING_PARTNER: Wallet operator — from BLADE_PARTNER_OUTSTANDING_LEDGER (latest per order, BOOKING+COMPLETED)

import { ORG_ID } from './constants';

// HELPER FUNCTIONS

// No date filter helper needed — date scoping done via terminal account transactions in orders_in_scope CTE

function buildLOBFilter(lob) {
  if (!lob) return '';
  const lobs = lob.split(',').map(l => l.trim()).filter(Boolean);
  if (lobs.length === 0) return '';
  if (lobs.includes('Ground')) {
    return `AND lob NOT IN ('Digital', 'Corporate')`;
  }
  if (lobs.length === 1) {
    return `AND lob = '${lobs[0]}'`;
  }
  const lobList = lobs.map(l => `'${l}'`).join(', ');
  return `AND lob IN (${lobList})`;
}

function buildCitiesFilter(cities) {
  if (!cities || cities.trim() === '') return '';
  const cityList = cities.split(',').map(c => `'${c.trim()}'`).join(', ');
  return `AND city IN (${cityList})`;
}

// BASE CTE BUILDER

function buildBaseCTE(startDate, endDate, dateType, lob, cities) {
  const lobFilter = buildLOBFilter(lob);
  const citiesFilter = buildCitiesFilter(cities);

  return `
WITH raw_orders AS (
  SELECT DISTINCT
    bo.ORDER_ID,
    bo.META_ORDER_STATUS as order_status,
    bo.PAYMENTS_TOTAL_ORDER_AMOUNT as total_revenue_paisa,
    bo.PAYMENTS_MARGIN as margin_paisa,
    bo.META_IS_BILL_TO_PATIENT,
    bo.ASSIGNMENT_PROVIDER_TYPE,
    bo.ASSIGNMENT_AMBULANCE_SERVICE_NAME,
    bo.TOTAL_ADDONS_PRICE,
    bo.META_CREATED_AT_TIMESTAMP,
    bo.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP,
    bo.FULFILLMENT_FULFILLED_AT_IST,
    bo.META_SITE_ID,
    bo.META_ORG_ID,
    bo.META_IS_FREE_TRIP,
    bo.META_SPECIAL_CATEGORY,
    bo.META_BOOKING_CREATED_BY,
    bo.META_ENQUIRY_CREATED_BY,
    bo.META_CREATED_BY,
    bo.META_ORDER_TYPE,
    bo.META_SERVICEDETAILS_SERVICETYPE,
    COALESCE(NULLIF(TRIM(n.NAME), ''), 'Unknown Hospital') as hospital_name,
    COALESCE(NULLIF(TRIM(bo.ASSIGNMENT_AMBULANCE_SERVICE_NAME), ''), 'Unknown Partner') as partner_name,
    DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', bo.META_CREATED_AT_TIMESTAMP)) as created_date,
    COALESCE(
      TO_DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', bo.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP)),
      TO_DATE(bo.FULFILLMENT_FULFILLED_AT_IST)
    ) as fulfilled_date,
    ROUND(bo.PAYMENTS_TOTAL_ORDER_AMOUNT / 100.0, 0) as total_revenue,
    ROUND(bo.PAYMENTS_MARGIN / 100.0, 0) as red_margin,
    CASE
      WHEN n.SITE_TYPE_DESC = 'DIGITAL' THEN 'Digital'
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Corporate'
      WHEN eu.user_type != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END as lob,
    CASE
      WHEN n.SITE_TYPE_DESC = 'DIGITAL' THEN 'DIGITAL'
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'CORPORATE'
      ELSE CASE
        WHEN UPPER(TRIM(IFNULL(n.CITY, 'UNKNOWN'))) IN ('GUWAHATI', 'GHT') THEN 'GHT'
        WHEN UPPER(TRIM(IFNULL(n.CITY, 'UNKNOWN'))) IN ('NAGPUR', 'NGP') THEN 'NGP'
        ELSE UPPER(TRIM(IFNULL(n.CITY, 'UNKNOWN')))
      END
    END as city,
    CASE WHEN bo.ASSIGNMENT_PROVIDER_TYPE = 'OWNED' THEN 'Own' ELSE 'Partner' END as provider_type,
    COALESCE(
      NULLIF(bo.META_BOOKING_CREATED_BY, ''),
      NULLIF(bo.META_ENQUIRY_CREATED_BY, ''),
      bo.META_CREATED_BY
    ) as created_by_email
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED n
    ON bo.META_SITE_ID = n.SITE_ID
  LEFT JOIN (
    SELECT email, user_type
    FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
    QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
  ) eu ON COALESCE(
    NULLIF(bo.META_BOOKING_CREATED_BY, ''),
    NULLIF(bo.META_ENQUIRY_CREATED_BY, ''),
    bo.META_CREATED_BY
  ) = eu.EMAIL
  WHERE bo.META_ORG_ID = '${ORG_ID}'
    AND bo.META_IS_FREE_TRIP = 0
    AND (bo.META_SPECIAL_CATEGORY IS NULL OR UPPER(bo.META_SPECIAL_CATEGORY) NOT LIKE '%TEST%')
    AND bo.META_ORDER_TYPE = 'BOOKING'
    AND IFNULL(bo.META_SERVICEDETAILS_SERVICETYPE, '') NOT IN ('AIR_AMBULANCE', 'DEAD_BODY_AIR_CARGO')
),

-- Orders that received payment at terminal account (bank) within the selected date range
-- Terminal account = Red Health / Red Health Finance Admin
-- TIMESTAMP is epoch (UTC) → convert to IST for date filtering
orders_in_scope AS (
  SELECT DISTINCT trm.ORDER_ID
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA trm
  LEFT JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA bao ON trm.CREDIT_ACCOUNT_ID = bao.ACCOUNT_ID
  WHERE trm.ORG_ID = '${ORG_ID}'
    AND bao.NAME IN ('Red Health', 'Red Health Finance Admin')
    AND trm.TRANSACTION_TYPE IN ('ORDER_PAYMENTS', 'BTC_TO_BTP', 'OFFLINE_ORDER_PAYMENTS', 'AUTO_ADJUSTMENT_SETTLEMENT')
    AND DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', TO_TIMESTAMP(trm.TIMESTAMP))) BETWEEN '${startDate}' AND '${endDate}'
),

base_orders AS (
  SELECT ro.* FROM raw_orders ro
  INNER JOIN orders_in_scope ois ON ro.ORDER_ID = ois.ORDER_ID
  WHERE 1=1
    ${lobFilter}
    ${citiesFilter}
),

-- TERMINAL ACCOUNT (ALL-TIME): Total amount ever received in Red Health bank for these orders
bank_alltime AS (
  SELECT
    trm.ORDER_ID,
    ROUND(SUM(TRY_TO_NUMBER(NULLIF(trm.AMOUNT::STRING, '')) / 100), 0) as bank_amount
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA trm
  LEFT JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA bao
    ON trm.CREDIT_ACCOUNT_ID = bao.ACCOUNT_ID
  WHERE trm.ORG_ID = '${ORG_ID}'
    AND bao.NAME IN ('Red Health', 'Red Health Finance Admin')
    AND trm.TRANSACTION_TYPE IN ('ORDER_PAYMENTS', 'BTC_TO_BTP', 'OFFLINE_ORDER_PAYMENTS', 'AUTO_ADJUSTMENT_SETTLEMENT')
  GROUP BY trm.ORDER_ID
),

-- TERMINAL ACCOUNT (THIS PERIOD): Amount received at bank within selected date range only
bank_period AS (
  SELECT
    trm.ORDER_ID,
    ROUND(SUM(TRY_TO_NUMBER(NULLIF(trm.AMOUNT::STRING, '')) / 100), 0) as bank_amount_period
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA trm
  LEFT JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA bao
    ON trm.CREDIT_ACCOUNT_ID = bao.ACCOUNT_ID
  WHERE trm.ORG_ID = '${ORG_ID}'
    AND bao.NAME IN ('Red Health', 'Red Health Finance Admin')
    AND trm.TRANSACTION_TYPE IN ('ORDER_PAYMENTS', 'BTC_TO_BTP', 'OFFLINE_ORDER_PAYMENTS', 'AUTO_ADJUSTMENT_SETTLEMENT')
    AND DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', TO_TIMESTAMP(trm.TIMESTAMP))) BETWEEN '${startDate}' AND '${endDate}'
  GROUP BY trm.ORDER_ID
),

-- WALLET INTERNAL: Outstanding balance held by internal employees (HM, Pilot, etc.)
-- Only for Bill-to-Patient orders, excludes PARTNER and ADMIN accounts
internal_outstanding AS (
  SELECT
    tr.ORDER_ID,
    ROUND(SUM(NULLIF(tr.OUTSTANDING_AMOUNT, '')::NUMBER) / 100.0, 0) as internal_amount
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA tr
  LEFT JOIN BLADE.CORE.RED_BLADE_ORDERS_FINAL bo ON tr.ORDER_ID = bo.ORDER_ID
  LEFT JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA ba
    ON tr.CREDIT_ACCOUNT_ID = ba.ACCOUNT_ID
  WHERE tr.ORG_ID = '${ORG_ID}'
    AND tr.PAYMENT_STATE = 'OUTSTANDING'
    AND tr.IS_TRANSACTION_TERMINAL = FALSE
    AND ba.ENTITY_TYPE NOT IN ('PARTNER', 'ADMIN')
    AND bo.META_IS_BILL_TO_PATIENT = TRUE
  GROUP BY tr.ORDER_ID
),

-- WALLET OPERATOR: Partner wallet from BLADE_PARTNER_OUTSTANDING_LEDGER
-- Latest record per order, only BOOKING + COMPLETED orders, excluding test cases
external_wallet AS (
  SELECT
    po.ORDER_ID,
    ROUND(SUM(po.AMOUNT / 100.0), 0) AS external_amount
  FROM (
    SELECT po.*
    FROM BLADE.RAW.BLADE_PARTNER_OUTSTANDING_LEDGER po
    WHERE po.ORG_ID = '${ORG_ID}'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY po.ORDER_ID ORDER BY po.CREATED_AT DESC) = 1
  ) po
  LEFT JOIN BLADE.CORE.RED_BLADE_ORDERS_FINAL bo ON po.ORDER_ID = bo.ORDER_ID
  WHERE bo.META_ORDER_TYPE = 'BOOKING'
    AND bo.META_ORDER_STATUS = 'COMPLETED'
    AND po.AMOUNT <> 0
    AND UPPER(COALESCE(bo.META_SPECIAL_CATEGORY, '')) NOT IN ('TEST CASE', 'TEST_CASE')
  GROUP BY po.ORDER_ID
)
  `;
}

// EXPORTED QUERY BUILDERS

export function buildCollectionsLOBSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE}
SELECT
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3) as AGE_0_3_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7) as AGE_4_7_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15) as AGE_8_15_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30) as AGE_16_30_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30) as AGE_30PLUS_COUNT,
  ROUND(AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())), 0) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.lob
ORDER BY ro.lob;
  `;
}

export function buildCollectionsSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE}
SELECT
  ro.city as CITY,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3) as AGE_0_3_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7) as AGE_4_7_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15) as AGE_8_15_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30) as AGE_16_30_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30) as AGE_30PLUS_COUNT,
  ROUND(AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())), 0) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, ro.lob
ORDER BY ro.city, ro.lob;
  `;
}

export function buildCollectionsHospitalQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE}
SELECT
  ro.city as CITY,
  ro.hospital_name as HOSPITAL_NAME,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3) as AGE_0_3_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7) as AGE_4_7_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15) as AGE_8_15_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30) as AGE_16_30_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30) as AGE_30PLUS_COUNT,
  ROUND(AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())), 0) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, ro.hospital_name, ro.lob
ORDER BY ro.city, ro.hospital_name, ro.lob;
  `;
}

export function buildCollectionsPartnerQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE}
SELECT
  ro.city as CITY,
  CASE WHEN ro.provider_type = 'Own' THEN 'Own Fleet' ELSE ro.partner_name END as PARTNER_NAME,
  ro.provider_type as PROVIDER_TYPE,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3) as AGE_0_3_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7) as AGE_4_7_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15) as AGE_8_15_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30) as AGE_16_30_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30) as AGE_30PLUS_COUNT,
  ROUND(AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())), 0) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, CASE WHEN ro.provider_type = 'Own' THEN 'Own Fleet' ELSE ro.partner_name END, ro.provider_type, ro.lob
ORDER BY ro.city, PARTNER_NAME, ro.lob;
  `;
}

export function buildCollectionsEmployeeQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE},
employee_details AS (
  SELECT email, user_type, name, status
  FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
  QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
)
SELECT
  COALESCE(ed.email, ro.created_by_email, 'Unknown') as EMPLOYEE_EMAIL,
  COALESCE(ed.name, 'Unknown') as EMPLOYEE_NAME,
  COALESCE(ed.user_type, 'Unknown') as EMPLOYEE_ROLE,
  COALESCE(ed.status, 'Unknown') as EMPLOYEE_STATUS,
  ro.city as CITY,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3) as AGE_0_3_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7) as AGE_4_7_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15) as AGE_8_15_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30) as AGE_16_30_COUNT,
  COUNT_IF(DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30) as AGE_30PLUS_COUNT,
  ROUND(AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())), 0) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN employee_details ed ON ro.created_by_email = ed.email
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ed.email, ed.name, ed.user_type, ed.status, ro.created_by_email, ro.city, ro.lob
ORDER BY EMPLOYEE_EMAIL, ro.city, ro.lob;
  `;
}

export function buildCollectionsTrendQuery(startDate, endDate, dateType, lob, cities) {
  const lobFilter = buildLOBFilter(lob);
  const citiesFilter = buildCitiesFilter(cities);
  // Trend by terminal account transaction date (payment received at bank)
  // Epoch TIMESTAMP in UTC → converted to IST
  const bankDateExpr = `DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', TO_TIMESTAMP(trm.TIMESTAMP)))`;

  return `
WITH raw_orders AS (
  SELECT DISTINCT bo.ORDER_ID,
    ROUND(bo.PAYMENTS_TOTAL_ORDER_AMOUNT / 100.0, 0) as total_revenue,
    ROUND(bo.PAYMENTS_MARGIN / 100.0, 0) as red_margin,
    CASE WHEN n.SITE_TYPE_DESC = 'DIGITAL' THEN 'Digital' WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Corporate' WHEN eu.user_type != 'CC_AGENT' THEN 'Hospital' ELSE 'Stan Command' END as lob,
    CASE WHEN n.SITE_TYPE_DESC = 'DIGITAL' THEN 'DIGITAL' WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'CORPORATE' ELSE CASE WHEN UPPER(TRIM(IFNULL(n.CITY,'UNKNOWN'))) IN ('GUWAHATI','GHT') THEN 'GHT' WHEN UPPER(TRIM(IFNULL(n.CITY,'UNKNOWN'))) IN ('NAGPUR','NGP') THEN 'NGP' ELSE UPPER(TRIM(IFNULL(n.CITY,'UNKNOWN'))) END END as city
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED n ON bo.META_SITE_ID = n.SITE_ID
  LEFT JOIN (SELECT email, user_type FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1) eu ON COALESCE(NULLIF(bo.META_BOOKING_CREATED_BY,''), NULLIF(bo.META_ENQUIRY_CREATED_BY,''), bo.META_CREATED_BY) = eu.EMAIL
  WHERE bo.META_ORG_ID = '${ORG_ID}' AND bo.META_IS_FREE_TRIP = 0 AND (bo.META_SPECIAL_CATEGORY IS NULL OR UPPER(bo.META_SPECIAL_CATEGORY) NOT LIKE '%TEST%') AND bo.META_ORDER_TYPE = 'BOOKING' AND IFNULL(bo.META_SERVICEDETAILS_SERVICETYPE, '') NOT IN ('AIR_AMBULANCE', 'DEAD_BODY_AIR_CARGO')
),
-- Daily terminal account collections (payment received at bank), grouped by transaction date (IST)
daily_bank AS (
  SELECT ${bankDateExpr} as trend_date, trm.ORDER_ID,
    ROUND(SUM(TRY_TO_NUMBER(NULLIF(trm.AMOUNT::STRING, '')) / 100.0), 0) as collected
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA trm
  LEFT JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA bao ON trm.CREDIT_ACCOUNT_ID = bao.ACCOUNT_ID
  WHERE trm.ORG_ID = '${ORG_ID}'
    AND bao.NAME IN ('Red Health', 'Red Health Finance Admin')
    AND trm.TRANSACTION_TYPE IN ('ORDER_PAYMENTS', 'BTC_TO_BTP', 'OFFLINE_ORDER_PAYMENTS', 'AUTO_ADJUSTMENT_SETTLEMENT')
    AND ${bankDateExpr} BETWEEN '${startDate}' AND '${endDate}'
  GROUP BY ${bankDateExpr}, trm.ORDER_ID
),
filtered_orders AS (SELECT * FROM raw_orders WHERE 1=1 ${lobFilter} ${citiesFilter}),
date_range AS (SELECT DATEADD(day, ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, '${startDate}'::DATE) as trend_date FROM TABLE(GENERATOR(ROWCOUNT => 366)))
SELECT dr.trend_date as TREND_DATE, COUNT(DISTINCT db.ORDER_ID) as ORDERS, ROUND(SUM(COALESCE(fo.total_revenue, 0)), 0) as REVENUE, ROUND(SUM(COALESCE(fo.red_margin, 0)), 0) as MARGIN, ROUND(SUM(COALESCE(db.collected, 0)), 0) as COLLECTED
FROM date_range dr LEFT JOIN daily_bank db ON db.trend_date = dr.trend_date LEFT JOIN filtered_orders fo ON db.ORDER_ID = fo.ORDER_ID
WHERE dr.trend_date BETWEEN '${startDate}'::DATE AND '${endDate}'::DATE GROUP BY dr.trend_date ORDER BY dr.trend_date;
  `;
}

export function buildCollectionsAgeingDetailQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE}
SELECT
  ro.city as CITY, ro.hospital_name as HOSPITAL_NAME, ro.lob as LOB, ro.ORDER_ID,
  ro.created_date as CREATED_DATE, ro.fulfilled_date as FULFILLED_DATE, ro.order_status as ORDER_STATUS,
  ro.total_revenue as TOTAL_REVENUE, ro.red_margin as RED_MARGIN,
  COALESCE(ba.bank_amount, 0) as RECEIVED_IN_BANK,
  COALESCE(bp.bank_amount_period, 0) as AT_BANK_IN_PERIOD,
  COALESCE(io.internal_amount, 0) as PENDING_EMPLOYEE,
  COALESCE(ew.external_amount, 0) as PENDING_PARTNER,
  ro.red_margin - COALESCE(ba.bank_amount, 0) as PENDING_COLLECTION,
  DATEDIFF(day, ro.created_date, CURRENT_DATE()) as DAYS_OUTSTANDING,
  CASE
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3 THEN 'Normal'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7 THEN 'High'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15 THEN 'Critical'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30 THEN 'Red Alert'
    ELSE 'Severe'
  END as RISK_TAG
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
ORDER BY ro.city, ro.hospital_name, ro.created_date DESC;
  `;
}

export function buildCollectionsB2HSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE},
b2h_costs AS (
  SELECT btd.ORDER_ID, ROUND(SUM(btd.AMOUNT) / 100.0, 0) as b2h_cost
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA btd
  WHERE btd.ORG_ID = '${ORG_ID}' AND btd.TRANSACTION_MODE = 'KIND'
  GROUP BY btd.ORDER_ID
)
SELECT
  ro.city as CITY, ro.hospital_name as HOSPITAL_NAME, ro.lob as LOB, ro.provider_type as PROVIDER_TYPE,
  CASE WHEN ro.provider_type = 'Own' THEN 'Own Fleet' ELSE ro.partner_name END as PARTNER_NAME,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(ba.bank_amount, 0)), 0) as TOTAL_RECEIVED_IN_BANK,
  ROUND(SUM(COALESCE(bp.bank_amount_period, 0)), 0) as TOTAL_AT_BANK_IN_PERIOD,

  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(ro.red_margin) - SUM(COALESCE(ba.bank_amount, 0)), 0) as PENDING_COLLECTION,
  ROUND(100.0 * SUM(COALESCE(ba.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0), 2) as COLLECTION_EFFICIENCY_PCT,
  ROUND(SUM(COALESCE(bc.b2h_cost, 0)), 0) as B2H_COST
FROM base_orders ro
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
LEFT JOIN b2h_costs bc ON ro.ORDER_ID = bc.ORDER_ID
WHERE ro.META_IS_BILL_TO_PATIENT = FALSE
GROUP BY ro.city, ro.hospital_name, ro.lob, ro.provider_type, CASE WHEN ro.provider_type = 'Own' THEN 'Own Fleet' ELSE ro.partner_name END
ORDER BY ro.city, ro.hospital_name, ro.lob;
  `;
}

export function buildCollectionsRawReportQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);
  return `${baseCTE},
employee_details AS (
  SELECT email, user_type, name
  FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
  QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
)
SELECT
  COALESCE(ed.name, ro.created_by_email, 'Unknown') as AGENT_NAME,
  COALESCE(ed.email, ro.created_by_email, 'Unknown') as AGENT_EMAIL,
  ro.city as CITY, ro.hospital_name as HOSPITAL_NAME,
  CASE WHEN ro.provider_type = 'Own' THEN 'Own Fleet' ELSE ro.partner_name END as PARTNER_NAME,
  ro.ORDER_ID, ro.order_status as ORDER_STATUS, ro.created_date as CREATED_DATE,
  ro.fulfilled_date as FULFILLED_DATE, ro.lob as LOB, ro.provider_type as PROVIDER_TYPE,
  ro.total_revenue as TOTAL_REVENUE, ro.red_margin as RED_MARGIN,
  COALESCE(ba.bank_amount, 0) as RECEIVED_IN_BANK,
  COALESCE(bp.bank_amount_period, 0) as AT_BANK_IN_PERIOD,
  COALESCE(io.internal_amount, 0) as PENDING_EMPLOYEE,
  COALESCE(ew.external_amount, 0) as PENDING_PARTNER,
  ro.red_margin - COALESCE(ba.bank_amount, 0) as PENDING_COLLECTION,
  CASE
    WHEN COALESCE(ba.bank_amount, 0) >= ro.red_margin THEN 'Collected'
    WHEN COALESCE(io.internal_amount, 0) > 0 AND COALESCE(ew.external_amount, 0) > 0 THEN 'Internal + Partner'
    WHEN COALESCE(io.internal_amount, 0) > 0 THEN 'Internal Employee'
    WHEN COALESCE(ew.external_amount, 0) > 0 THEN 'Partner'
    ELSE 'Pending'
  END as COLLECTION_SOURCE,
  CASE WHEN ro.provider_type = 'Partner' THEN ro.total_revenue - ro.red_margin ELSE 0 END as COST_TO_OPERATOR,
  ROUND(COALESCE(ro.TOTAL_ADDONS_PRICE, 0) / 100.0, 0) as ADDONS_PRICE,
  COALESCE(ba.bank_amount, 0)
    - CASE WHEN ro.provider_type = 'Partner' THEN GREATEST(0, COALESCE(ba.bank_amount, 0) - ro.red_margin) ELSE 0 END
    as NET_CASH_TO_COMPANY
FROM base_orders ro
LEFT JOIN employee_details ed ON ro.created_by_email = ed.email
LEFT JOIN bank_alltime ba ON ro.ORDER_ID = ba.ORDER_ID
LEFT JOIN bank_period bp ON ro.ORDER_ID = bp.ORDER_ID

LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
ORDER BY ro.city, ro.created_date DESC, ro.ORDER_ID;
  `;
}
