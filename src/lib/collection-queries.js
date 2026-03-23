const ORG_ID = '14927ff8-a1f6-49ba-abcb-7bb1cf842d52';

/**
 * Builds a city-level collections summary query for Red Health
 * Shows total margin, bank receipts, outstanding wallets, and collection efficiency by city
 */
export function buildCollectionsSummaryQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH order_base AS (
      -- Get B2P orders with fulfillment dates within wallet range
      SELECT DISTINCT o.ORDER_ID,
        o.META_CITY,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        o.META_IS_BILL_TO_PATIENT,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    bank_receipts AS (
      -- CLEARED transactions to COMPANY (money at bank)
      SELECT
        t.ORDER_ID,
        SUM(t.AMOUNT / 100.0) AS bank_amount,
        TO_TIMESTAMP(MIN(t.TIMESTAMP))::DATE AS wallet_date,
        MAX(COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP)))::DATE AS payment_date,
        AVG(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP)))) AS avg_collection_days
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_internal AS (
      -- OUTSTANDING to internal staff (PILOT, HM, CC_AGENT, PARAMEDIC, AOM)
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount,
        TO_TIMESTAMP(MIN(t.TIMESTAMP))::DATE AS wallet_date,
        MIN(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE)) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.IS_TRANSACTION_TERMINAL = FALSE
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE IN ('PILOT', 'HM', 'CC_AGENT', 'PARAMEDIC', 'AOM')
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_partner AS (
      -- OUTSTANDING to PARTNER entities
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount,
        TO_TIMESTAMP(MIN(t.TIMESTAMP))::DATE AS wallet_date,
        MIN(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE)) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.IS_TRANSACTION_TERMINAL = FALSE
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'PARTNER'
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    ageing_buckets AS (
      -- Outstanding transactions grouped by age buckets
      SELECT
        t.ORDER_ID,
        CASE
          WHEN DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) <= 3 THEN '0_3'
          WHEN DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) <= 7 THEN '4_7'
          WHEN DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) <= 15 THEN '8_15'
          WHEN DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) <= 30 THEN '16_30'
          ELSE '30_plus'
        END AS ageing_bucket,
        CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END AS outstanding_amount,
        DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.IS_TRANSACTION_TERMINAL = FALSE
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    summary_data AS (
      SELECT
        ob.CITY,
        COUNT(DISTINCT ob.ORDER_ID) AS total_orders,
        SUM(ob.PAYMENTS_MARGIN / 100) AS total_margin,
        COALESCE(SUM(br.bank_amount), 0) AS total_at_bank,
        COALESCE(SUM(oi.outstanding_amount), 0) AS total_outstanding_internal,
        COALESCE(SUM(op.outstanding_amount), 0) AS total_outstanding_partner,
        MAX(br.avg_collection_days) AS avg_collection_days,
        COUNT(DISTINCT CASE WHEN ab.ageing_bucket = '0_3' THEN ab.ORDER_ID END) AS age_0_3_count,
        COUNT(DISTINCT CASE WHEN ab.ageing_bucket = '4_7' THEN ab.ORDER_ID END) AS age_4_7_count,
        COUNT(DISTINCT CASE WHEN ab.ageing_bucket = '8_15' THEN ab.ORDER_ID END) AS age_8_15_count,
        COUNT(DISTINCT CASE WHEN ab.ageing_bucket = '16_30' THEN ab.ORDER_ID END) AS age_16_30_count,
        COUNT(DISTINCT CASE WHEN ab.ageing_bucket = '30_plus' THEN ab.ORDER_ID END) AS age_30_plus_count,
        SUM(CASE WHEN ab.ageing_bucket = '0_3' THEN ab.outstanding_amount ELSE 0 END) AS age_amt_0_3,
        SUM(CASE WHEN ab.ageing_bucket = '4_7' THEN ab.outstanding_amount ELSE 0 END) AS age_amt_4_7,
        SUM(CASE WHEN ab.ageing_bucket = '8_15' THEN ab.outstanding_amount ELSE 0 END) AS age_amt_8_15,
        SUM(CASE WHEN ab.ageing_bucket = '16_30' THEN ab.outstanding_amount ELSE 0 END) AS age_amt_16_30,
        SUM(CASE WHEN ab.ageing_bucket = '30_plus' THEN ab.outstanding_amount ELSE 0 END) AS age_amt_30_plus
      FROM order_base ob
      LEFT JOIN bank_receipts br ON ob.ORDER_ID = br.ORDER_ID
      LEFT JOIN outstanding_internal oi ON ob.ORDER_ID = oi.ORDER_ID
      LEFT JOIN outstanding_partner op ON ob.ORDER_ID = op.ORDER_ID
      LEFT JOIN ageing_buckets ab ON ob.ORDER_ID = ab.ORDER_ID
      GROUP BY ob.CITY
    )

    SELECT
      CITY,
      total_orders,
      total_margin,
      total_at_bank,
      total_outstanding_internal,
      total_outstanding_partner,
      GREATEST(0, total_margin - total_at_bank) AS pending_collection,
      CASE
        WHEN total_margin > 0 THEN ROUND((total_at_bank / total_margin) * 100, 2)
        ELSE 0
      END AS collection_efficiency_pct,
      age_0_3_count,
      age_4_7_count,
      age_8_15_count,
      age_16_30_count,
      age_30_plus_count,
      COALESCE(age_amt_0_3, 0) AS age_amt_0_3,
      COALESCE(age_amt_4_7, 0) AS age_amt_4_7,
      COALESCE(age_amt_8_15, 0) AS age_amt_8_15,
      COALESCE(age_amt_16_30, 0) AS age_amt_16_30,
      COALESCE(age_amt_30_plus, 0) AS age_amt_30_plus,
      ROUND(COALESCE(avg_collection_days, 0), 2) AS avg_collection_days
    FROM summary_data
    ORDER BY CITY;
  `;
}

/**
 * Builds a hospital-level collections query
 * Shows collections metrics grouped by city and hospital with ageing flags
 */
export function buildCollectionsHospitalQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH order_base AS (
      SELECT DISTINCT o.ORDER_ID,
        o.META_CITY,
        o.META_SITE_ID,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        o.META_IS_BILL_TO_PATIENT,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    hospital_names AS (
      SELECT DISTINCT
        SITE_ID,
        NAME AS hospital_name
      FROM BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED
    ),

    bank_receipts AS (
      SELECT
        t.ORDER_ID,
        SUM(t.AMOUNT / 100.0) AS bank_amount,
        MAX(COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP)))::DATE AS payment_date
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_internal AS (
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount,
        MIN(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE)) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.IS_TRANSACTION_TERMINAL = FALSE
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE IN ('PILOT', 'HM', 'CC_AGENT', 'PARAMEDIC', 'AOM')
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_partner AS (
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount,
        MIN(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE)) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.IS_TRANSACTION_TERMINAL = FALSE
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'PARTNER'
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    ageing_analysis AS (
      SELECT
        t.ORDER_ID,
        DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE) AS days_outstanding,
        CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END AS outstanding_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    hospital_summary AS (
      SELECT
        ob.CITY,
        hn.hospital_name,
        ob.META_SITE_ID,
        COUNT(DISTINCT ob.ORDER_ID) AS total_orders,
        SUM(ob.PAYMENTS_MARGIN / 100) AS total_margin,
        COALESCE(SUM(br.bank_amount), 0) AS total_at_bank,
        COALESCE(SUM(oi.outstanding_amount), 0) AS total_outstanding_internal,
        COALESCE(SUM(op.outstanding_amount), 0) AS total_outstanding_partner,
        MAX(CASE WHEN aa.days_outstanding > 7 THEN TRUE ELSE FALSE END) AS high_ageing_flag,
        MAX(CASE WHEN aa.days_outstanding > 15 THEN TRUE ELSE FALSE END) AS critical_flag
      FROM order_base ob
      LEFT JOIN hospital_names hn ON ob.META_SITE_ID = hn.SITE_ID
      LEFT JOIN bank_receipts br ON ob.ORDER_ID = br.ORDER_ID
      LEFT JOIN outstanding_internal oi ON ob.ORDER_ID = oi.ORDER_ID
      LEFT JOIN outstanding_partner op ON ob.ORDER_ID = op.ORDER_ID
      LEFT JOIN ageing_analysis aa ON ob.ORDER_ID = aa.ORDER_ID
      GROUP BY ob.CITY, hn.hospital_name, ob.META_SITE_ID
    )

    SELECT
      CITY,
      COALESCE(hospital_name, 'Unknown') AS hospital_name,
      META_SITE_ID,
      total_orders,
      total_margin,
      total_at_bank,
      total_outstanding_internal,
      total_outstanding_partner,
      GREATEST(0, total_margin - total_at_bank) AS pending_collection,
      CASE
        WHEN total_margin > 0 THEN ROUND((total_at_bank / total_margin) * 100, 2)
        ELSE 0
      END AS collection_efficiency_pct,
      COALESCE(high_ageing_flag, FALSE) AS high_ageing_flag,
      COALESCE(critical_flag, FALSE) AS critical_flag
    FROM hospital_summary
    ORDER BY CITY, hospital_name;
  `;
}

/**
 * Builds a partner-level collections query
 * Shows collections metrics for PARTNER entities with ageing analysis
 */
export function buildCollectionsPartnerQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH order_base AS (
      SELECT DISTINCT o.ORDER_ID,
        o.META_CITY,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        o.META_IS_BILL_TO_PATIENT,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    partner_transactions AS (
      SELECT
        t.ORDER_ID,
        t.CREDIT_ACCOUNT_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS wallet_amount,
        TO_TIMESTAMP(MIN(t.TIMESTAMP))::DATE AS wallet_date,
        t.PAYMENT_STATE,
        MIN(DATEDIFF(day, TO_TIMESTAMP(t.TIMESTAMP), CURRENT_DATE)) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'PARTNER'
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID, t.CREDIT_ACCOUNT_ID, t.PAYMENT_STATE
    ),

    partner_accounts AS (
      SELECT
        ACCOUNT_ID,
        NAME AS partner_name
      FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
      WHERE ENTITY_TYPE = 'PARTNER'
    ),

    partner_summary AS (
      SELECT
        ob.CITY,
        pa.partner_name,
        pt.CREDIT_ACCOUNT_ID,
        COUNT(DISTINCT ob.ORDER_ID) AS total_orders,
        SUM(ob.PAYMENTS_MARGIN / 100) AS total_margin,
        SUM(CASE WHEN pt.PAYMENT_STATE = 'CLEARED' THEN pt.wallet_amount ELSE 0 END) AS total_at_bank,
        SUM(CASE WHEN pt.PAYMENT_STATE = 'OUTSTANDING' THEN pt.wallet_amount ELSE 0 END) AS total_outstanding,
        COUNT(DISTINCT CASE WHEN pt.PAYMENT_STATE = 'OUTSTANDING' AND pt.days_outstanding > 7 THEN ob.ORDER_ID END) AS orders_over_7_days,
        COUNT(DISTINCT CASE WHEN pt.PAYMENT_STATE = 'OUTSTANDING' AND pt.days_outstanding > 15 THEN ob.ORDER_ID END) AS orders_over_15_days,
        SUM(CASE WHEN pt.PAYMENT_STATE = 'OUTSTANDING' AND pt.days_outstanding > 7 THEN pt.wallet_amount ELSE 0 END) AS amt_over_7_days
      FROM order_base ob
      LEFT JOIN partner_transactions pt ON ob.ORDER_ID = pt.ORDER_ID
      LEFT JOIN partner_accounts pa ON pt.CREDIT_ACCOUNT_ID = pa.ACCOUNT_ID
      WHERE pt.CREDIT_ACCOUNT_ID IS NOT NULL
      GROUP BY ob.CITY, pa.partner_name, pt.CREDIT_ACCOUNT_ID
    )

    SELECT
      CITY,
      COALESCE(partner_name, 'Unknown Partner') AS partner_name,
      CREDIT_ACCOUNT_ID,
      total_orders,
      total_margin,
      total_at_bank,
      total_outstanding,
      GREATEST(0, total_margin - total_at_bank) AS pending_collection,
      CASE
        WHEN total_margin > 0 THEN ROUND((total_at_bank / total_margin) * 100, 2)
        ELSE 0
      END AS collection_efficiency_pct,
      orders_over_7_days,
      orders_over_15_days,
      amt_over_7_days
    FROM partner_summary
    ORDER BY CITY, partner_name;
  `;
}

/**
 * Builds an employee-level collections query
 * Shows collections metrics grouped by city and employee creator
 */
export function buildCollectionsEmployeeQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH order_base AS (
      SELECT DISTINCT o.ORDER_ID,
        o.META_CITY,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        COALESCE(o.META_BOOKING_CREATED_BY, o.META_ENQUIRY_CREATED_BY, o.META_CREATED_BY) AS employee_id,
        o.META_IS_BILL_TO_PATIENT,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    bank_receipts AS (
      SELECT
        t.ORDER_ID,
        SUM(t.AMOUNT / 100.0) AS bank_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_total AS (
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    employee_summary AS (
      SELECT
        ob.CITY,
        ob.employee_id,
        COUNT(DISTINCT ob.ORDER_ID) AS total_orders,
        SUM(ob.PAYMENTS_MARGIN / 100) AS total_margin,
        COALESCE(SUM(br.bank_amount), 0) AS total_at_bank,
        COALESCE(SUM(ot.outstanding_amount), 0) AS total_outstanding
      FROM order_base ob
      LEFT JOIN bank_receipts br ON ob.ORDER_ID = br.ORDER_ID
      LEFT JOIN outstanding_total ot ON ob.ORDER_ID = ot.ORDER_ID
      WHERE ob.employee_id IS NOT NULL
      GROUP BY ob.CITY, ob.employee_id
    )

    SELECT
      CITY,
      COALESCE(employee_id, 'Unknown') AS employee_name,
      total_orders,
      total_margin,
      total_at_bank,
      total_outstanding,
      GREATEST(0, total_margin - total_at_bank) AS pending_collection,
      CASE
        WHEN total_margin > 0 THEN ROUND((total_at_bank / total_margin) * 100, 2)
        ELSE 0
      END AS collection_efficiency_pct
    FROM employee_summary
    ORDER BY CITY, employee_name;
  `;
}

/**
 * Builds a daily trend query for collections
 * Shows daily wallet creation, payments received, outstanding, and efficiency
 */
export function buildCollectionsTrendQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH daily_wallets AS (
      -- Margin of orders where wallet was created each day
      SELECT
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS trend_date,
        SUM(o.PAYMENTS_MARGIN / 100) AS wallet_created_amt
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE
    ),

    daily_payments AS (
      -- Bank receipts cleared each day
      SELECT
        COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE AS trend_date,
        SUM(t.AMOUNT / 100.0) AS payment_received_amt
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE
    ),

    daily_outstanding AS (
      -- Daily new outstanding transactions
      SELECT
        TO_TIMESTAMP(t.TIMESTAMP)::DATE AS trend_date,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amt
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY TO_TIMESTAMP(t.TIMESTAMP)::DATE
    ),

    date_range AS (
      SELECT
        d::DATE AS trend_date
      FROM TABLE(GENERATOR(ROWCOUNT => DATEDIFF(day, '${walletStart}'::DATE, '${walletEnd}'::DATE) + 1))
      CROSS JOIN (SELECT '${walletStart}'::DATE AS start_date)
      QUALIFY ROW_NUMBER() OVER (ORDER BY d) <= DATEDIFF(day, '${walletStart}'::DATE, '${walletEnd}'::DATE) + 1
    )

    SELECT
      dr.trend_date,
      COALESCE(dw.wallet_created_amt, 0) AS wallet_created_amt,
      COALESCE(dp.payment_received_amt, 0) AS payment_received_amt,
      COALESCE(do.outstanding_amt, 0) AS outstanding_amt,
      CASE
        WHEN COALESCE(dw.wallet_created_amt, 0) > 0
          THEN ROUND((COALESCE(dp.payment_received_amt, 0) / COALESCE(dw.wallet_created_amt, 0)) * 100, 2)
        ELSE 0
      END AS collection_efficiency_pct
    FROM date_range dr
    LEFT JOIN daily_wallets dw ON dr.trend_date = dw.trend_date
    LEFT JOIN daily_payments dp ON dr.trend_date = dp.trend_date
    LEFT JOIN daily_outstanding do ON dr.trend_date = do.trend_date
    ORDER BY dr.trend_date;
  `;
}

/**
 * Builds a detailed order-level ageing query
 * Shows individual orders with outstanding amounts and ageing risk tags
 */
export function buildCollectionsAgeingDetailQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH order_base AS (
      SELECT DISTINCT o.ORDER_ID,
        o.META_CITY,
        o.META_SITE_ID,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        o.ASSIGNMENT_PROVIDER_TYPE,
        COALESCE(o.META_BOOKING_CREATED_BY, o.META_ENQUIRY_CREATED_BY, o.META_CREATED_BY) AS created_by,
        o.META_IS_BILL_TO_PATIENT,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = TRUE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    hospital_names AS (
      SELECT DISTINCT
        SITE_ID,
        NAME AS hospital_name
      FROM BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED
    ),

    bank_receipts AS (
      SELECT
        t.ORDER_ID,
        SUM(t.AMOUNT / 100.0) AS bank_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY t.ORDER_ID
    ),

    outstanding_detail AS (
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount,
        TO_TIMESTAMP(MIN(t.TIMESTAMP))::DATE AS wallet_date,
        DATEDIFF(day, TO_TIMESTAMP(MIN(t.TIMESTAMP)), CURRENT_DATE) AS days_outstanding
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    ageing_details AS (
      SELECT
        ob.ORDER_ID,
        ob.CITY,
        COALESCE(hn.hospital_name, 'Unknown') AS hospital_name,
        CASE WHEN ob.ASSIGNMENT_PROVIDER_TYPE = 'OWNED' THEN 'OWN' ELSE 'Partner' END AS provider_type,
        COALESCE(ob.created_by, 'Unknown') AS created_by,
        ob.PAYMENTS_MARGIN AS wallet_amount,
        COALESCE(br.bank_amount, 0) AS bank_amount,
        COALESCE(od.outstanding_amount, 0) AS outstanding_amount,
        COALESCE(od.wallet_date, ob.fulfilled_date) AS wallet_date,
        COALESCE(od.days_outstanding, 0) AS days_outstanding,
        CASE
          WHEN COALESCE(od.days_outstanding, 0) <= 3 THEN '0-3 days'
          WHEN COALESCE(od.days_outstanding, 0) <= 7 THEN '4-7 days'
          WHEN COALESCE(od.days_outstanding, 0) <= 15 THEN '8-15 days'
          WHEN COALESCE(od.days_outstanding, 0) <= 30 THEN '16-30 days'
          ELSE '30+ days'
        END AS ageing_bucket,
        CASE
          WHEN COALESCE(od.days_outstanding, 0) > 30 THEN 'Red Alert'
          WHEN COALESCE(od.days_outstanding, 0) > 15 THEN 'Critical'
          WHEN COALESCE(od.days_outstanding, 0) > 7 THEN 'High'
          ELSE 'Normal'
        END AS risk_tag,
        CASE
          WHEN COALESCE(br.bank_amount, 0) > 0 THEN 'Partial Collection'
          WHEN COALESCE(od.outstanding_amount, 0) > 0 THEN 'Pending'
          ELSE 'Collected'
        END AS collection_from
      FROM order_base ob
      LEFT JOIN hospital_names hn ON ob.META_SITE_ID = hn.SITE_ID
      LEFT JOIN bank_receipts br ON ob.ORDER_ID = br.ORDER_ID
      LEFT JOIN outstanding_detail od ON ob.ORDER_ID = od.ORDER_ID
      WHERE COALESCE(od.outstanding_amount, 0) > 0
    )

    SELECT
      ORDER_ID,
      CITY,
      hospital_name,
      provider_type,
      created_by,
      wallet_amount,
      bank_amount,
      outstanding_amount,
      wallet_date,
      days_outstanding,
      ageing_bucket,
      risk_tag,
      collection_from
    FROM ageing_details
    ORDER BY days_outstanding DESC, CITY, hospital_name;
  `;
}

/**
 * Builds a B2H (Bill-to-Hospital) collections summary query
 * Shows operator cost breakdown and partner payables for B2H orders
 */
export function buildCollectionsB2HSummaryQuery(walletStart, walletEnd, paymentStart, paymentEnd) {
  return `
    WITH b2h_orders AS (
      SELECT
        o.ORDER_ID,
        o.META_CITY,
        o.PAYMENTS_TOTAL_ORDER_AMOUNT,
        o.PAYMENTS_MARGIN,
        CASE
          WHEN o.META_CITY IN ('Guwahati', 'GHT') THEN 'GHT'
          WHEN o.META_CITY IN ('Nagpur', 'NGP') THEN 'NGP'
          ELSE o.META_CITY
        END AS CITY,
        o.META_IS_BILL_TO_PATIENT,
        o.ASSIGNMENT_PROVIDER_TYPE,
        o.META_IS_FREE_TRIP,
        o.META_SPECIAL_CATEGORY,
        COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE AS fulfilled_date,
        o.META_ORG_ID
      FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL o
      WHERE o.META_ORG_ID = '${ORG_ID}'
        AND o.META_IS_BILL_TO_PATIENT = FALSE
        AND IFNULL(o.META_IS_FREE_TRIP,FALSE)<>TRUE
        AND (IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%TEST%' AND IFNULL(o.META_SPECIAL_CATEGORY,'') NOT LIKE '%AIR_AMBULANCE%')
        AND COALESCE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', o.ASSIGNMENT_REACHEDDROPOFFAT_TIMESTAMP), o.FULFILLMENT_FULFILLED_AT_IST)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
    ),

    bank_receipts AS (
      SELECT
        t.ORDER_ID,
        SUM(t.AMOUNT / 100.0) AS bank_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'CLEARED'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'COMPANY'
        )
        AND COALESCE(t.PAYMENT_SETTLED_AT_TIMESTAMP, TO_TIMESTAMP(t.TIMESTAMP))::DATE BETWEEN '${paymentStart}' AND '${paymentEnd}'
      GROUP BY t.ORDER_ID
    ),

    partner_outstanding AS (
      SELECT
        t.ORDER_ID,
        SUM(CASE WHEN t.OUTSTANDING_AMOUNT IS NOT NULL
          THEN TRY_CAST(t.OUTSTANDING_AMOUNT AS NUMBER) / 100
          ELSE t.AMOUNT / 100.0
        END) AS outstanding_amount
      FROM BLADE.RAW.BLADE_TRANSACTIONS_DATA t
      WHERE t.ORG_ID = '${ORG_ID}'
        AND t.PAYMENT_STATE = 'OUTSTANDING'
        AND t.TRANSACTION_MODE != 'KIND'
        AND t.CREDIT_ACCOUNT_ID IN (
          SELECT ACCOUNT_ID FROM BLADE.RAW.BLADE_ACCOUNTS_DATA
          WHERE ENTITY_TYPE = 'PARTNER'
        )
        AND TO_TIMESTAMP(t.TIMESTAMP)::DATE BETWEEN '${walletStart}' AND '${walletEnd}'
      GROUP BY t.ORDER_ID
    ),

    b2h_summary AS (
      SELECT
        bo.CITY,
        COUNT(DISTINCT bo.ORDER_ID) AS total_orders,
        SUM(bo.PAYMENTS_TOTAL_ORDER_AMOUNT / 100) AS total_case_value,
        SUM(bo.PAYMENTS_MARGIN / 100) AS total_margin,
        SUM((bo.PAYMENTS_TOTAL_ORDER_AMOUNT - bo.PAYMENTS_MARGIN) / 100) AS total_cost_to_operator,
        0 AS total_addons,
        SUM(CASE
          WHEN bo.PAYMENTS_MARGIN < (bo.PAYMENTS_TOTAL_ORDER_AMOUNT - bo.PAYMENTS_MARGIN)
            THEN bo.PAYMENTS_MARGIN / 100
          ELSE (bo.PAYMENTS_TOTAL_ORDER_AMOUNT - bo.PAYMENTS_MARGIN) / 100
        END) AS payable_to_partner,
        COALESCE(SUM(po.outstanding_amount), 0) AS partner_wallet_outstanding
      FROM b2h_orders bo
      LEFT JOIN bank_receipts br ON bo.ORDER_ID = br.ORDER_ID
      LEFT JOIN partner_outstanding po ON bo.ORDER_ID = po.ORDER_ID
      GROUP BY bo.CITY
    )

    SELECT
      CITY,
      total_orders,
      total_case_value,
      total_margin,
      total_cost_to_operator,
      total_addons,
      payable_to_partner,
      partner_wallet_outstanding,
      GREATEST(0, total_margin - partner_wallet_outstanding) AS collected_from_partner
    FROM b2h_summary
    WHERE total_case_value > 0
    ORDER BY CITY;
  `;
}
