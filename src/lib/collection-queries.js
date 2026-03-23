// Red Health Collections & Payments Dashboard Query Builder
// Snowflake SQL query builder with new parameter structure:
// (startDate, endDate, dateType, lob, cities)
// dateType: 'wallet' or 'payment'

const ORG_ID = '14927ff8-a1f6-49ba-abcb-7bb1cf842d52';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build date filter for wallet or payment dates
 * @param {string} dateType - 'wallet' or 'payment'
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} endDate - YYYY-MM-DD format
 * @returns {string} WHERE clause fragment
 */
function buildDateFilter(dateType, startDate, endDate) {
  if (dateType === 'wallet') {
    return `created_date BETWEEN '${startDate}' AND '${endDate}'`;
  } else if (dateType === 'payment') {
    return `fulfilled_date BETWEEN '${startDate}' AND '${endDate}'`;
  }
  return '1=1';
}

/**
 * Build LOB filter clause
 * @param {string} lob - LOB name or 'Ground' (means NOT IN Digital/Corporate)
 * @returns {string} AND clause fragment (empty string if lob is null/falsy)
 */
function buildLOBFilter(lob) {
  if (!lob) return '';

  if (lob === 'Ground') {
    return `AND lob NOT IN ('Digital', 'Corporate')`;
  }
  return `AND lob = '${lob}'`;
}

/**
 * Build cities filter clause
 * @param {string} cities - Comma-separated city codes
 * @returns {string} AND clause fragment (empty string if cities is null/empty)
 */
function buildCitiesFilter(cities) {
  if (!cities || cities.trim() === '') return '';

  const cityList = cities.split(',').map(c => `'${c.trim()}'`).join(', ');
  return `AND city IN (${cityList})`;
}

// =============================================================================
// BASE CTE BUILDER
// =============================================================================

/**
 * Build the base CTE with all calculations
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} dateType - 'wallet' or 'payment'
 * @param {string} lob - LOB filter (or null)
 * @param {array|string} cities - Cities filter (or null)
 * @returns {string} WITH clause containing base_orders and payment details
 */
function buildBaseCTE(startDate, endDate, dateType, lob, cities) {
  const dateFilter = buildDateFilter(dateType, startDate, endDate);
  const lobFilter = buildLOBFilter(lob);
  const citiesFilter = buildCitiesFilter(cities);

  return `
WITH raw_orders AS (
  SELECT DISTINCT
    bo.ORDER_ID,
    bo.META_CITY as meta_city,
    bo.META_ORDER_STATUS as order_status,
    bo.PAYMENTS_TOTAL_ORDER_AMOUNT as total_revenue_paisa,
    bo.PAYMENTS_MARGIN as margin_paisa,
    bo.META_IS_BILL_TO_PATIENT,
    bo.ASSIGNMENT_PROVIDER_TYPE,
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
    IFNULL(oe.NAME, 'Unknown Hospital') as hospital_name,
    -- Computed fields
    CONVERT_TIMEZONE('UTC','Asia/Kolkata', bo.META_CREATED_AT_TIMESTAMP)::DATE as created_date,
    COALESCE(
      CONVERT_TIMEZONE('UTC','Asia/Kolkata', bo.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP),
      bo.FULFILLMENT_FULFILLED_AT_IST
    )::DATE as fulfilled_date,
    ROUND(bo.PAYMENTS_TOTAL_ORDER_AMOUNT / 100.0, 0) as total_revenue,
    ROUND(bo.PAYMENTS_MARGIN / 100.0, 0) as red_margin,
    -- LOB determination
    CASE
      WHEN oe.SITE_TYPE_DESC = 'DIGITAL' THEN 'Digital'
      WHEN oe.SITE_TYPE_DESC = 'CORPORATE' THEN 'Corporate'
      WHEN eu.USER_TYPE != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END as lob,
    -- City determination with normalization
    CASE
      WHEN oe.SITE_TYPE_DESC = 'DIGITAL' THEN 'DIGITAL'
      WHEN oe.SITE_TYPE_DESC = 'CORPORATE' THEN 'CORPORATE'
      ELSE CASE
        WHEN UPPER(TRIM(IFNULL(oe.CITY, 'UNKNOWN'))) IN ('GUWAHATI', 'GHT') THEN 'GHT'
        WHEN UPPER(TRIM(IFNULL(oe.CITY, 'UNKNOWN'))) IN ('NAGPUR', 'NGP') THEN 'NGP'
        ELSE UPPER(TRIM(IFNULL(oe.CITY, 'UNKNOWN')))
      END
    END as city,
    -- Own vs Partner
    CASE WHEN bo.ASSIGNMENT_PROVIDER_TYPE = 'OWNED' THEN 'Own' ELSE 'Partner' END as provider_type,
    -- Created by user reference
    COALESCE(bo.META_BOOKING_CREATED_BY, bo.META_ENQUIRY_CREATED_BY, bo.META_CREATED_BY) as created_by_id
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED oe
    ON bo.META_SITE_ID = oe.SITE_ID AND bo.META_ORG_ID = oe.ORGANIZATION_ID
  LEFT JOIN BLADE.RAW.BLADE_USER_ENTITIES eu
    ON COALESCE(bo.META_BOOKING_CREATED_BY, bo.META_ENQUIRY_CREATED_BY, bo.META_CREATED_BY) = eu.USER_ID
      AND bo.META_ORG_ID = eu.ORGANIZATION_ID
  WHERE bo.META_ORG_ID = '${ORG_ID}'
    AND bo.META_IS_FREE_TRIP = 0
    AND (bo.META_SPECIAL_CATEGORY IS NULL OR UPPER(bo.META_SPECIAL_CATEGORY) NOT LIKE '%TEST%')
    AND bo.META_ORDER_TYPE = 'BOOKING'
    AND IFNULL(bo.META_SERVICEDETAILS_SERVICETYPE, '') NOT IN ('AIR_AMBULANCE', 'DEAD_BODY_AIR_CARGO')
),

base_orders AS (
  SELECT * FROM raw_orders
  WHERE ${dateFilter}
    ${lobFilter}
    ${citiesFilter}
),

company_receipts AS (
  SELECT
    btd.ORDER_ID,
    ROUND(SUM(btd.AMOUNT) / 100.0, 0) as bank_amount
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA btd
  JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA ba
    ON btd.CREDIT_ACCOUNT_ID = ba.ACCOUNT_ID
  WHERE btd.ORG_ID = '${ORG_ID}'
    AND btd.PAYMENT_STATE = 'CLEARED'
    AND ba.ENTITY_TYPE = 'COMPANY'
    AND btd.TRANSACTION_MODE != 'KIND'
  GROUP BY btd.ORDER_ID
),

internal_outstanding AS (
  SELECT
    btd.ORDER_ID,
    ROUND(SUM(TRY_CAST(btd.OUTSTANDING_AMOUNT AS NUMBER)) / 100.0, 0) as internal_amount
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA btd
  JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA ba
    ON btd.CREDIT_ACCOUNT_ID = ba.ACCOUNT_ID
  WHERE btd.ORG_ID = '${ORG_ID}'
    AND btd.PAYMENT_STATE = 'OUTSTANDING'
    AND btd.IS_TRANSACTION_TERMINAL = FALSE
    AND ba.ENTITY_TYPE NOT IN ('PARTNER', 'ADMIN')
  GROUP BY btd.ORDER_ID
),

external_wallet AS (
  SELECT
    btd.ORDER_ID,
    ROUND(SUM(btd.AMOUNT) / 100.0, 0) as external_amount
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA btd
  JOIN BLADE.RAW.BLADE_ACCOUNTS_DATA ba
    ON btd.CREDIT_ACCOUNT_ID = ba.ACCOUNT_ID
  WHERE btd.ORG_ID = '${ORG_ID}'
    AND btd.PAYMENT_STATE = 'OUTSTANDING'
    AND ba.ENTITY_TYPE = 'PARTNER'
  GROUP BY btd.ORDER_ID
)
  `;
}

// =============================================================================
// EXPORTED QUERY BUILDERS
// =============================================================================

/**
 * Build Collections Summary Query - GROUP BY CITY, LOB
 */
export function buildCollectionsSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  ro.city as CITY,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3
  ) as AGE_0_3_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7
  ) as AGE_4_7_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15
  ) as AGE_8_15_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30
  ) as AGE_16_30_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30
  ) as AGE_30PLUS_COUNT,
  ROUND(
    AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())),
    0
  ) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, ro.lob
ORDER BY ro.city, ro.lob;
  `;
}

/**
 * Build Collections by Hospital Query - GROUP BY CITY, HOSPITAL_NAME, LOB
 */
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
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3
  ) as AGE_0_3_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7
  ) as AGE_4_7_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15
  ) as AGE_8_15_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30
  ) as AGE_16_30_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30
  ) as AGE_30PLUS_COUNT,
  ROUND(
    AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())),
    0
  ) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, ro.hospital_name, ro.lob
ORDER BY ro.city, ro.hospital_name, ro.lob;
  `;
}

/**
 * Build Collections by Partner Query - GROUP BY CITY, HOSPITAL_NAME, provider_type, LOB
 */
export function buildCollectionsPartnerQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  ro.city as CITY,
  ro.hospital_name as HOSPITAL_NAME,
  ro.provider_type as PROVIDER_TYPE,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3
  ) as AGE_0_3_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7
  ) as AGE_4_7_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15
  ) as AGE_8_15_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30
  ) as AGE_16_30_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30
  ) as AGE_30PLUS_COUNT,
  ROUND(
    AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())),
    0
  ) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.city, ro.hospital_name, ro.provider_type, ro.lob
ORDER BY ro.city, ro.hospital_name, ro.provider_type, ro.lob;
  `;
}

/**
 * Build Collections by Employee Query
 * Joins to employee data and groups by employee, city, LOB
 */
export function buildCollectionsEmployeeQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  eu.EMAIL as EMPLOYEE_EMAIL,
  eu.NAME as EMPLOYEE_NAME,
  eu.USER_TYPE as EMPLOYEE_ROLE,
  eu.STATUS as EMPLOYEE_STATUS,
  ro.city as CITY,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3
  ) as AGE_0_3_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7
  ) as AGE_4_7_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15
  ) as AGE_8_15_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30
  ) as AGE_16_30_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30
  ) as AGE_30PLUS_COUNT,
  ROUND(
    AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())),
    0
  ) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN BLADE.RAW.BLADE_USER_ENTITIES eu
  ON ro.created_by_id = eu.USER_ID AND eu.ORGANIZATION_ID = '${ORG_ID}'
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY eu.EMAIL, eu.NAME, eu.USER_TYPE, eu.STATUS, ro.city, ro.lob
ORDER BY eu.EMAIL, ro.city, ro.lob;
  `;
}

/**
 * Build Collections Trend Query - Daily breakdown
 */
export function buildCollectionsTrendQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE},

date_range AS (
  SELECT DATEADD(day, ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1, '${startDate}'::DATE) as trend_date
  FROM TABLE(GENERATOR(ROWCOUNT => DATEDIFF(day, '${startDate}'::DATE, '${endDate}'::DATE) + 1))
)

SELECT
  dr.trend_date,
  COUNT(DISTINCT ro.ORDER_ID) as ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as REVENUE,
  ROUND(SUM(ro.red_margin), 0) as MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as COLLECTED
FROM date_range dr
LEFT JOIN base_orders ro ON ro.created_date = dr.trend_date
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
GROUP BY dr.trend_date
ORDER BY dr.trend_date;
  `;
}

/**
 * Build Collections Ageing Detail Query - Per-order detail with risk tags
 */
export function buildCollectionsAgeingDetailQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  ro.city as CITY,
  ro.hospital_name as HOSPITAL_NAME,
  ro.ORDER_ID,
  ro.created_date as CREATED_DATE,
  ro.fulfilled_date as FULFILLED_DATE,
  ro.order_status as ORDER_STATUS,
  ro.total_revenue as TOTAL_REVENUE,
  ro.red_margin as RED_MARGIN,
  COALESCE(cr.bank_amount, 0) as AT_BANK,
  COALESCE(io.internal_amount, 0) as PENDING_EMPLOYEE,
  COALESCE(ew.external_amount, 0) as PENDING_PARTNER,
  GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0)) as PENDING_COLLECTION,
  DATEDIFF(day, ro.created_date, CURRENT_DATE()) as DAYS_OUTSTANDING,
  CASE
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3 THEN 'Normal'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7 THEN 'High'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15 THEN 'Critical'
    WHEN DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30 THEN 'Red Alert'
    ELSE 'Severe'
  END as RISK_TAG
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
ORDER BY ro.city, ro.hospital_name, ro.created_date DESC;
  `;
}

/**
 * Build Collections B2H Summary Query - With KIND transaction costs
 */
export function buildCollectionsB2HSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE},

b2h_costs AS (
  SELECT
    btd.ORDER_ID,
    ROUND(SUM(btd.AMOUNT) / 100.0, 0) as b2h_cost
  FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA btd
  WHERE btd.ORG_ID = '${ORG_ID}'
    AND btd.TRANSACTION_MODE = 'KIND'
  GROUP BY btd.ORDER_ID
)

SELECT
  ro.city as CITY,
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  ROUND(SUM(COALESCE(bc.b2h_cost, 0)), 0) as B2H_COST
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
LEFT JOIN b2h_costs bc ON ro.ORDER_ID = bc.ORDER_ID
GROUP BY ro.city, ro.lob
ORDER BY ro.city, ro.lob;
  `;
}

/**
 * Build Collections LOB Summary Query - GROUP BY LOB only
 */
export function buildCollectionsLOBSummaryQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  ro.lob as LOB,
  COUNT(DISTINCT ro.ORDER_ID) as TOTAL_ORDERS,
  ROUND(SUM(ro.total_revenue), 0) as TOTAL_REVENUE,
  ROUND(SUM(ro.red_margin), 0) as TOTAL_RED_MARGIN,
  ROUND(SUM(COALESCE(cr.bank_amount, 0)), 0) as TOTAL_AT_BANK,
  ROUND(SUM(COALESCE(io.internal_amount, 0)), 0) as TOTAL_PENDING_EMPLOYEE,
  ROUND(SUM(COALESCE(ew.external_amount, 0)), 0) as TOTAL_PENDING_PARTNER,
  ROUND(SUM(GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0))), 0) as PENDING_COLLECTION,
  ROUND(
    100.0 * SUM(COALESCE(cr.bank_amount, 0)) / NULLIF(SUM(ro.red_margin), 0),
    2
  ) as COLLECTION_EFFICIENCY_PCT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 0 AND 3
  ) as AGE_0_3_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 4 AND 7
  ) as AGE_4_7_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 8 AND 15
  ) as AGE_8_15_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) BETWEEN 16 AND 30
  ) as AGE_16_30_COUNT,
  COUNTIF(
    DATEDIFF(day, ro.created_date, CURRENT_DATE()) > 30
  ) as AGE_30PLUS_COUNT,
  ROUND(
    AVG(DATEDIFF(day, ro.created_date, CURRENT_DATE())),
    0
  ) as AVG_COLLECTION_TAT_DAYS
FROM base_orders ro
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
GROUP BY ro.lob
ORDER BY ro.lob;
  `;
}

/**
 * Build Collections Raw Report Query - Per-order details
 */
export function buildCollectionsRawReportQuery(startDate, endDate, dateType, lob, cities) {
  const baseCTE = buildBaseCTE(startDate, endDate, dateType, lob, cities);

  return `${baseCTE}
SELECT
  IFNULL(eu.EMAIL, 'Unknown') as EMPLOYEE_EMAIL,
  ro.city as CITY,
  ro.hospital_name as HOSPITAL_NAME,
  ro.ORDER_ID,
  ro.order_status as ORDER_STATUS,
  ro.created_date as CREATED_DATE,
  ro.fulfilled_date as FULFILLED_DATE,
  ro.lob as LOB,
  ro.provider_type as PROVIDER_TYPE,
  ro.total_revenue as TOTAL_REVENUE,
  ro.red_margin as RED_MARGIN,
  COALESCE(cr.bank_amount, 0) as TOTAL_AT_BANK,
  COALESCE(io.internal_amount, 0) as PENDING_EMPLOYEE,
  COALESCE(ew.external_amount, 0) as PENDING_PARTNER,
  GREATEST(0, ro.red_margin - COALESCE(cr.bank_amount, 0)) as PENDING_COLLECTION,
  CASE
    WHEN COALESCE(cr.bank_amount, 0) >= ro.red_margin THEN 'Collected'
    WHEN COALESCE(io.internal_amount, 0) > 0 AND COALESCE(ew.external_amount, 0) > 0 THEN 'Internal + Partner'
    WHEN COALESCE(io.internal_amount, 0) > 0 THEN 'Internal Employee'
    WHEN COALESCE(ew.external_amount, 0) > 0 THEN 'Partner'
    ELSE 'Pending'
  END as COLLECTION_SOURCE,
  CASE WHEN ro.provider_type = 'Partner' THEN ro.total_revenue - ro.red_margin ELSE 0 END as COST_TO_OPERATOR,
  CASE WHEN ro.provider_type = 'Own'
    THEN ROUND(COALESCE(ro.TOTAL_ADDONS_PRICE, 0) / 100.0, 0)
    ELSE 0 END as ADDONS_COST,
  COALESCE(cr.bank_amount, 0)
    - CASE WHEN ro.provider_type = 'Partner' THEN GREATEST(0, COALESCE(cr.bank_amount, 0) - ro.red_margin) ELSE 0 END
    - CASE WHEN ro.provider_type = 'Own' THEN ROUND(COALESCE(ro.TOTAL_ADDONS_PRICE, 0) / 100.0, 0) ELSE 0 END
    as NET_CASH_TO_COMPANY
FROM base_orders ro
LEFT JOIN BLADE.RAW.BLADE_USER_ENTITIES eu
  ON ro.created_by_id = eu.USER_ID AND eu.ORGANIZATION_ID = '${ORG_ID}'
LEFT JOIN company_receipts cr ON ro.ORDER_ID = cr.ORDER_ID
LEFT JOIN internal_outstanding io ON ro.ORDER_ID = io.ORDER_ID
LEFT JOIN external_wallet ew ON ro.ORDER_ID = ew.ORDER_ID
ORDER BY ro.city, ro.created_date DESC, ro.ORDER_ID;
  `;
}

