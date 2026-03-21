import { ORG_ID } from './constants';

// ============================================================
// CITYWISE FUNNEL QUERY â Locked Logic v8
// MTD till today, compare today vs yesterday
// Excludes Digital, Air Ambulance, Test orders
// Revenue in Lakhs (paise Ã· 10,000,000)
// ============================================================
export function buildFunnelQuery(mtdStart, mtdEnd, today, yesterday) {
  return `
WITH base AS (
  SELECT
    UPPER(TRIM(n.CITY)) AS CITY,
    CASE
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Stan Command'
      WHEN eu.USER_TYPE != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END AS LOB,
    DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP)) AS created_date,
    bo.ORDER_ID, bo.META_ORDER_TYPE, bo.META_ORDER_STATUS,
    bo.META_IS_FREE_TRIP, bo.PAYMENTS_TOTAL_ORDER_AMOUNT
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED n
    ON bo.META_SITE_ID = n.SITE_ID
  LEFT JOIN (
    SELECT email, user_type
    FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
    QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
  ) eu ON COALESCE(
    NULLIF(bo.META_BOOKING_CREATED_BY,''),
    NULLIF(bo.META_ENQUIRY_CREATED_BY,''),
    bo.META_CREATED_BY
  ) = eu.EMAIL
  WHERE bo.META_ORG_ID = '${ORG_ID}'
    AND COALESCE(bo.META_ORDER_TYPE,'') != 'TEST'
    AND IFNULL(bo.META_SERVICEDETAILS_SERVICETYPE,'') NOT IN ('AIR_AMBULANCE','DEAD_BODY_AIR_CARGO')
    AND n.SITE_TYPE_DESC != 'DIGITAL'
    AND UPPER(TRIM(n.CITY)) IS NOT NULL
    AND DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP))
        BETWEEN '${mtdStart}' AND '${mtdEnd}'
)
SELECT
  CITY,
  SUM(CASE WHEN META_ORDER_TYPE IN ('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS MTD_ENQUIRY,
  SUM(CASE WHEN META_ORDER_TYPE = 'BOOKING' THEN 1 ELSE 0 END) AS MTD_BOOKING,
  SUM(CASE WHEN META_ORDER_TYPE = 'BOOKING' AND META_ORDER_STATUS IN ('IN_PROGRESS','COMPLETED') THEN 1 ELSE 0 END) AS MTD_TRIP,
  SUM(CASE WHEN META_ORDER_TYPE = 'BOOKING' AND META_ORDER_STATUS = 'COMPLETED' THEN 1 ELSE 0 END) AS MTD_TRIP_COMP,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS MTD_REV_BKD_L,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS IN('CANCELLED','DISPUTED')
    AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS MTD_REV_CAN_L,
  ROUND(
    SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS IN('CANCELLED','DISPUTED')
      AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)
    / NULLIF(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
      THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END),0)*100, 1) AS MTD_CANCEL_PCT,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' THEN 1 ELSE 0 END)*100.0
    / NULLIF(SUM(CASE WHEN META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END),0), 1) AS MTD_BKG_CONV_PCT,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END)*100.0
    / NULLIF(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' THEN 1 ELSE 0 END),0), 1) AS MTD_TRIP_COMP_PCT,
  -- Today
  SUM(CASE WHEN created_date='${today}' AND META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS TODAY_ENQUIRY,
  SUM(CASE WHEN created_date='${today}' AND META_ORDER_TYPE='BOOKING' THEN 1 ELSE 0 END) AS TODAY_BOOKING,
  SUM(CASE WHEN created_date='${today}' AND META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END) AS TODAY_TRIP_COMP,
  ROUND(SUM(CASE WHEN created_date='${today}' AND META_ORDER_TYPE='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS TODAY_REV_BKD_L,
  -- Yesterday
  SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS YDAY_ENQUIRY,
  SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TYPE='BOOKING' THEN 1 ELSE 0 END) AS YDAY_BOOKING,
  SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END) AS YDAY_TRIP_COMP,
  ROUND(SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TYPE='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS YDAY_REV_BKD_L
FROM base
GROUP BY CITY
ORDER BY MTD_REV_BKD_L DESC NULLS LAST`;
}

// ============================================================
// CITYWISE FINANCE QUERY â Locked Logic v8
// MTD till today, compare today vs yesterday
// Excludes Digital, Air Ambulance (DEAD_BODY_AIR_CARGO included)
// Revenue in Rupees (paise Ã· 100)
// ============================================================
export function buildFinanceQuery(mtdStart, mtdEnd, today, yesterday) {
  return `
WITH base AS (
  SELECT
    UPPER(TRIM(n.CITY)) AS CITY,
    CASE
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Stan Command'
      WHEN eu.user_type != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END AS LOB,
    COALESCE(
      TO_DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', f.assignment_reacheddropoffat_timestamp)),
      TO_DATE(f.FULFILLMENT_FULFILLED_AT_IST)
    ) AS fin_date,
    DATE_TRUNC('month', COALESCE(
      TO_DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', f.assignment_reacheddropoffat_timestamp)),
      TO_DATE(f.FULFILLMENT_FULFILLED_AT_IST)
    )) AS fin_month,
    DATE_TRUNC('month', DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', f.META_CREATED_AT_TIMESTAMP))) AS created_month,
    f.order_id, f.META_IS_FREE_TRIP, f.META_IS_BILL_TO_PATIENT,
    f.PAYMENTS_TOTAL_ORDER_AMOUNT, f.PAYMENTS_MARGIN, f.PAYMENTS_TOTAL_DISCOUNT,
    f.DIGITAL_CUSTOMER_PAYMENT_AMOUNT, f.ASSIGNMENT_PROVIDER_TYPE,
    f.META_SERVICEDETAILS_SERVICETYPE, v.bm_model_type
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL f
  LEFT JOIN BLADE.CORE.BLADE_VEHICLES_DATA v ON v.vehicle_id = f.assignment_ambulance_id
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED n ON f.meta_site_id = n.site_id
  LEFT JOIN (
    SELECT email, user_type FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
    QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
  ) eu ON eu.email = f.META_BOOKING_CREATED_BY
  WHERE f.META_ORG_ID = '${ORG_ID}'
    AND f.META_ORDER_STATUS NOT IN ('CANCELLED','DISPUTED')
    AND f.META_ORDER_TYPE = 'BOOKING'
    AND IFNULL(f.meta_servicedetails_servicetype,'') != 'AIR_AMBULANCE'
    AND COALESCE(f.META_ORDER_TYPE,'') != 'TEST'
    AND n.SITE_TYPE_DESC != 'DIGITAL'
    AND UPPER(TRIM(n.CITY)) IS NOT NULL
    AND COALESCE(
      TO_DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata', f.assignment_reacheddropoffat_timestamp)),
      TO_DATE(f.FULFILLMENT_FULFILLED_AT_IST)
    ) BETWEEN '${mtdStart}' AND '${mtdEnd}'
)
SELECT
  CITY,
  COUNT(order_id) AS MTD_TRIPS_DELIVERED,
  ROUND(SUM(CASE WHEN IFNULL(META_IS_FREE_TRIP,FALSE)=TRUE THEN 0 ELSE IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 END), 0) AS MTD_REV,
  ROUND(SUM(CASE WHEN ASSIGNMENT_PROVIDER_TYPE!='OWNED' THEN PAYMENTS_MARGIN/100 END), 0) AS MTD_MARGIN_AMT,
  ROUND(SUM(CASE WHEN ASSIGNMENT_PROVIDER_TYPE!='OWNED' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END),0) AS MTD_NON_OWN_REV,
  ROUND(
    SUM(CASE WHEN ASSIGNMENT_PROVIDER_TYPE!='OWNED' THEN PAYMENTS_MARGIN/100 END)
    / NULLIF(SUM(CASE WHEN ASSIGNMENT_PROVIDER_TYPE!='OWNED' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
      THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END),0)*100, 1) AS MTD_MARGIN_PCT,
  ROUND(SUM(CASE WHEN META_IS_BILL_TO_PATIENT=TRUE AND PAYMENTS_TOTAL_ORDER_AMOUNT>100
    AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(DIGITAL_CUSTOMER_PAYMENT_AMOUNT,0)/100 END), 0) AS MTD_DQR,
  ROUND(
    SUM(CASE WHEN META_IS_BILL_TO_PATIENT=TRUE AND PAYMENTS_TOTAL_ORDER_AMOUNT>100
      AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(DIGITAL_CUSTOMER_PAYMENT_AMOUNT,0)/100 END)
    / NULLIF(SUM(CASE WHEN IFNULL(META_IS_FREE_TRIP,FALSE)=TRUE THEN 0 ELSE IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 END),0)*100, 1) AS MTD_DQR_PCT,
  ROUND(SUM(CASE WHEN bm_model_type='OWNED' AND META_SERVICEDETAILS_SERVICETYPE IN('ROAD_AMBULANCE','DEAD_BODY_ROAD_TRANSPORT')
    AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END),0) AS MTD_OWN_ROAD_REV,
  ROUND(SUM(CASE WHEN META_SERVICEDETAILS_SERVICETYPE IN('ROAD_AMBUTANCE','DEAD_BODY_ROAD_TRANSPORT')
    AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END),0) AS MTD_ROAD_REV,
  ROUND(
    SUM(CASE WHEN bm_model_type='OWNED' AND META_SERVICEDETAILS_SERVICETYPE IN('ROAD_AMBULANCE','DEAD_BODY_ROAD_TRANSPORT')
      AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END)
    / NULLIF(SUM(CAQe WHEN META_SERVICEDETAILS_SERVICETYPE IN('ROAD_AMBULANCE','DEAD_BODY_ROAD_TRANSPORT')
      AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 ELSE 0 END),0)*100, 1) AS MTD_OWN_ROAD_PCT,
  COUNT(CASE WHEN fin_date='${today}' THEN order_id END) AS TODAY_TRIPS,
  ROUND(SUM(CASE WHEN fin_date='${today}' THEN CASE WHEN IFNULL(META_IS_FREE_TRIP,FALSE)=TRUE THEN 0
    ELSE IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 END ELSE 0 END),0) AS TODAY_REV,
  COUNT(CASE WHEN fin_date='${yesterday}' THEN order_id END) AS YDAY_TRIPS,
  ROUND(SUM(CASE WHEN fin_date='${yesterday}' THEN CASE WHEN IFNULL(META_IS_FREE_TRIP,FALSE)=TRUE THEN 0
    ELSE IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0)/100 END ELSE 0 END),0) AS YDAY_REV
FROM base
GROUP BY CITY
ORDER BY MTD_REV DESC NULLS LAST`;
}

// ============================================================
// HOSPITAL-WISE FUNNEL QUERY â Locked Logic v8
// MTD till today, compare today vs yesterday
// Groups by CITY + HOSPITAL (site name)
// ============================================================
export function buildHospitalQuery(mtdStart, mtdEnd, today, yesterday) {
  return `
WITH base AS (
  SELECT
    UPPER(TRIM(n.CITY)) AS CITY,
    COALESCE(NULLIF(TRIM(n.NAME),''), 'Unknown Hospital') AS HOSPITAL,
    DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP)) AS created_date,
    bo.ORDER_ID, bo.META_ORDER_TYPE, bo.META_ORDER_STATUS,
    bo.META_IS_FREE_TRIP, bo.PAYMENTS_TOTAL_ORDER_AMOUNT
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT JOIN BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTENED n
    ON bo.META_SITE_ID = n.SITE_ID
  WHERE bo.META_ORG_ID = '${ORG_ID}'
    AND COALESCE(bo.META_ORDER_TYPE,'') != 'TEST'
    AND IFNULL(bo.META_SERVICEDETAILS_SERVICETYPE,'') NOT IN ('AIR_AMBULANCE','DEAD_BODY_AIR_CARGO')
    AND n.SITE_TYPE_DESC != 'DIGITAL'
    AND UPPER(TRIM(n.CITY)) IS NOT NULL
    AND DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP))
        BETWEEN '${mtdStart}' AND '${mtdEnd}'
)
SELECT
  CITY,
  HOSPITAL,
  SUM(CASE WHEN META_ORDER_TYPE IN ('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS MTD_ENQUIRY,
  SUM(CASE WHEN META_ORDER_TYPE = 'BOOKING' THEN 1 ELSE 0 END) AS MTD_BOOKING,
  SUM(CASE WHEN META_ORDER_TYPE = 'BOOKING' AND META_ORDER_STATUS = 'COMPLETED' THEN 1 ELSE 0 END) AS MTD_TRIP_COMP,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE=='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS MTD_REV_BKD_L,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE=='BOOKING' AND META_ORDER_STATUS IN('CANCELLED','DISPUTED')
    AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS MTD_REV_CAN_L,
  ROUND(
    SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS IN('CANCELLED','DISPUTED')
      AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)
    / NULLIF(SUM(CARE WHEN META_ORDER_TYPE='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
      THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END),0)*100, 1) AS MTD_CANCEL_PCT,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE=='BOOKING' THEN 1 ELSE 0 END)*100.0
    / NULLIF(SUM(CASE WHEN META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END),0), 1) AS MTD_BKG_CONV_PCT,
  ROUND(SUM(CASE WHEN META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END)*100.0
    / NULLIF(SUM(CASE WHEN META_ORDER_TYPE=='BOOKING' THEN 1 ELSE 0 END),0), 1) AS MTD_TRIP_COMP_PCT,
  SUM(CASE WHEN created_date='${today}' AND META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS TODAY_ENQUIRY,
  SUM(CARE WHEN created_date='${today}' AND META_ORDER_TYPE=='BOOKING' THEN 1 ELSE 0 END) AS TODAY_BOOKING,
  SUM(CARE WHEN created_date='${today}' AND META_ORDER_TUPE=='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END) AS TODAY_TRIP_COMP,
  ROUND(SUM(CASE WHEN created_date='${today}' AND META_ORDER_TUPE=='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS TODAY_REV_BKD_L,
  SUM(CARE WHEN created_date='${yesterday}' AND META_ORDER_TYPE IN('ENQUIRY','BOOKING') THEN 1 ELSE 0 END) AS YDAY_ENQUIRY,
  SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TYP%='BOOKING' THEN 1 ELSE 0 END) AS YDAY_BOOKING,
  SUM(CARE WHEN created_date='${yesterday}' AND META_ORDER_TYPE='BOOKING' AND META_ORDER_STATUS='COMPLETED' THEN 1 ELSE 0 END) AS YDAY_TRIP_COMP,
  ROUND(SUM(CASE WHEN created_date='${yesterday}' AND META_ORDER_TUPE=='BOOKING' AND IFNULL(META_IS_FREE_TRIP,FALSE)<>TRUE
    THEN IFNULL(PAYMENTS_TOTAL_ORDER_AMOUNT,0) ELSE 0 END)/10000000,2) AS YDAY_REV_BKD_L
FROM base
GROUP BY CITY, HOSPITAL
HAVING MTD_BOOKING > 0
ORDER BY MTD_REV_BKD_L DESC NULLS LAST`;
}

// ============================================================
// AGENT-WISE FUNNEL QUERY pâ Locked Logic v8
// MTD till today, compare today vs yesterday
// Groups by CITY + AGENT (booking creator email)
// ============================================================
export function buildAgentQuery(mtdStart, mtdEnd, today, yesterday) {
  return `
WITH base AS (
  SELECT
    UPPER(TRIM(n.CITY)) AS CITY,
    COALESCE(
      NULLIF(bo.META_BOOKING_CREATED_BY,''),
      NULLIF(bo.META_ENQUIRY_CREATED_BY,''),
      bo.META_CREATED_BY
    ) AS AGENT_EMAIL,
    CASE
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Stan Command'
      WHEN eu.USER_TYPE != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END AS LOB,
    DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP)) AS created_date,
    bo.ORDER_ID, bo.META_ORDER_TYPE, bo.META_ORDER_STATUS,
    bo.META_IS_FREE_TRIP, bo.PAYMENTS_TOTAL_ORDER_AMOUNT
  FROM BLADE.CORE.RED_BLADE_ORDERS_FINAL bo
  LEFT C�ON BLADE.CORE.BLADE_ORGANIZATION_ENTITIES_NEW_FLATTEQED N(��< C<�U- HSTE_ID = n.SITE_ID
  LEFT JOIN (
    SELECT email, user_type
    FROM BLADE.CORE.BLADE_USER_ENTITIES_PARSED
    QUALIFY ROW_NuM_BER() OVER (PARTITION BY email ORDER BY created_at DESC) = 1
  ) eu ON COALESCE(�Ё  EM A_BOOKING_CREATQD_BY, ''),
    NULLIF(bo.META_ENQUIRY_CREATED_BY,''),
    bo.META_CREATQD_BY
  ) = eu.EMAIL
  WHERE bo.META_ORG_ID = '${ORG_ID}'
    AND bo.META_ORDER_SATUS NOT IN ('CANCELLED','DISPUTED')
    AND bo.META_ORDER_TYPE = 'BOOKING'
    AND IFNULL���WF�6W'f�6VFWF��5�6W'f�6WG�R�rr��t�%��%T��4Rp��B4��U44R�&���UD��$DU%�E�R�rr��uDU5Bp��B��4�DU�E�U�DU42�tD�t�D�p��BUU"�E$�҆��4�E����2��B�T����B4��U44R��D��DDR�4��dU%E�D��U���R�uUD2r�t6����ƶFr�&���UD�5$TDTE�E�D��U5D�����D��DDR�&��eT�d����T�E�eT�d���TE�E��5B���$UEtTT�rG��FE7F'G�r�BrG��FDV�G�p� ELSE 0 END)/10000000,2) AS YDAY_REV_BKD_L
FROM base
GROUP BY CITY, HOSPITAL
HAVING MTD_BOOKING > 0
ORDER BY MTD_REV_BKD_L DESC NULLS LAST`;
}

// ============================================================
// AGENT-WISE FUNNEL QUERY â Locked Logic v8
// MTD till today, compare today vs yesterday
// Groups by CITY + AGENT (booking creator email)
// ============================================================
export function buildAgentQuery(mtdStart, mtdEnd, today, yesterday) {
  return `
WITH base AS (
  SELECT
    UPPER(TRIM(n.CITY)) AS CITY,
    COALESCE(
      NULLIF(bo.META_BOOKING_CREATED_BY,''),
      NULLIF(bo.META_ENQUIRY_CREATED_BY,''),
      bo.META_CREATED_BY
    ) AS AGENT_EMAIL,
    CASE
      WHEN n.SITE_TYPE_DESC = 'CORPORATE' THEN 'Stan Command'
      WHEN eu.USER_TYPE != 'CC_AGENT' THEN 'Hospital'
      ELSE 'Stan Command'
    END AS LOB,
    DATE(CONVERT_TIMEZONE('UTC','Asia/Kolkata',bo.META_CREATED_AT_TIMESTAMP)) AS created_date,
    bo.ORDER_ID, bo.META_ORDER_TYPE, bo.META_ORDER_STATUS,
    bo.META_IS_FREE_TRIP, bo.PAYMENTS_TOTAL_ORDER_AMOUNT
  FROM BLADE.CORE.RED_BL@�D_ORDERS_FINAL bo
  LEFT C�ON BLADE.CORE.BMD_ORGANIZATION_ENTITIES_NEW_FLATTEQED N(��< C<�U- HSTE_ID = n.SITE_ID
  LEFT JOIN (
    SELECT email, user_type FROM BLADE.CORE.BME}UMI}9Q%Q%M}AIM(����EU1%d�I=]}9U5	H���=YH��AIQ%Q%=8�	d�������=IH�	d��ɕ�ѕ�}�ЁM����(�����ԁ=8��Թ������􁉼�5Q}	==-%9}
IQ}	d(��]!I����5Q}=I}%�􀜑�=I}%��(����9����5Q}=II}MQQUL�9=P�%8���
9
11���%MAUQ��(����9����5Q}=II}QeA�	==-%9�(����9�%9U10������х}͕�٥����х���}͕�٥�������������%I}5	U19
�(����9�
=1M
����5Q}=II}QeA�������QMP�(����9���M%Q}QeA}M���%%Q0�(����9�UAAH�QI%4���
%Qd���%L�9=P�9U10(����9�
=1M
��(����Q=}Q�
=9YIQ}Q%5i=9��UQ���ͥ��-����ф������5Q}
IQE}Q}Q%5MQ5@���(������Q=}Q����U1%1159Q}U1%11}Q}%MP�(������	Q]8����QIQ���9���5Q9��(�)M1
P(��
%Qd�(��
=1M
�9Q}5%0���U����ݸ���L�9P�(��1=�(��MU4�
M�]!8�5Q}=II}QeA�%8���9EU%Id���	==-%9���Q!8�ā1M���9��L�5Q}9EU%Id�(��MU4�
M�]!8�5Q}=II}QeA�	==-%9��Q!8�ā1M���9��L�5Q}	==-%9�(��MU4�
M�]!8�5Q}=II}Qe@��	==-%9��9�5Q}=II}MQQUL��
=5A1Q��Q!8�ā1M���9��L�5Q}QI%A
=5@�(��I=U9�MU4�
M�]!8�5Q}=II}QeA��	==-%9��9�%9U10�5Q}%M}I}QI%@�1M���QIU(����Q!8�%9U10�Ae59QM}Q=Q1}=II}5=U9P����1M���9�����������Ȥ�L�5Q}IY}	-}0�(��I=U9�MU4�
M�]!8�5Q}=II}QUA���	==-%9��9�5Q}=II}MQQUL�%8��
9
11���%MAUQ��(����9�%9U10�5Q}%M}I}QI%@�1M���QIU(����Q!8�%9U10�Ae59QM}Q=Q1}=II}5=U9P����1M���9�����������Ȥ�L�5Q}IY}
9}0�(��I=U9�(����MU4�
M�]!8�5Q}=II}QeA��	==-%9��9�5Q}=II}MQQUL�%8��
9
11���%MAUQ��(������9�%9U10�5Q}%M}I}QI%@�1M���QIU�Q!8�%9U10�Ae59QM}Q=Q1}=II}5=U9P����1M���9�(������9U11%�MU4�
I�]!8�5Q}=II}QeA��	==-%9��9�%9U10�5Q}%M}I}QI%@�1M���QIU(������Q!8�%9U10�Ae59QM}Q=Q1}=II}5=U9P����1M���9����������Ĥ�L�5Q}
9
1}A
P�(��I=U9�MU4�
M�]!8�5Q}=II}QUA���	==-%9��Q!8�ā1M���9�������(������9U11%�MU4�
M�]!8�5Q}=II}QeA�%8��9EU%Id���	==-%9���Q!8�ā1M���9������Ĥ�L�5Q}	-}
=9Y}A
P�(��MU4�
I�]!8��ɕ�ѕ�}��є����ѽ������9�5Q}=II}QeA�%8��9EU%Id���	==-%9���Q!8�ā1M���9��L�Q=e}9EU%Id�(��MU4�
M�]!8��ɕ�ѕ�}��є����ѽ������9�5Q}=II}QeA��	==-%9��Q!8�ā1M���9��L�Q=e}	==-%9�(��MU4�
I�]!8��ɕ�ѕ�}��є������ѕɑ�����9�5Q}=II}QeA�%8��9EU%Id���	==-%9���Q!8�ā1M���9��L�ee}9EU%Id�(��MU4�
M�]!8��ɕ�ѕ�}��є������ѕɑ�����9�5Q}=II}UeA��	==-%9��Q!8�ā1M���9��L�ee}	==-%9)I=4���͔)I=U@�	d�
%Qd��9Q}5%0��1=)!Y%9�5Q}QI%AM}1%YI����)=IH�	d�
%Qd��!=MA%Q0��9Q}5%0��1=�%R�	d�5�Q}IY}	-}0�M�9U11L�1MQ��)�((���������������������������������������������������������������(���!=MA%Q0�]%M�%99
�EUId(���M����-A%́�́���䵱�ٕ������������ɽ�������
%Qd���!=MA%Q0(���������������������������������������������������������������)�����Ё�չ�ѥ����ե��!����х�������EՕ�䡵ёMх�а��ё����ѽ��䰁��ѕɑ�䤁�(��ɕ��ɸ��)]%Q ���͔�L��(��M1
P(����UAAH�QI%4���
%Qd���L�
%Qd�(����
=1M
�9U11%�QI%4���95��������U����ݸ�!����х����L�!=MA%Q0�(����
=1M
�(������Q=}Q�
=9YIQ}Q%5i=9��UQ���ͥ��-����ф�������ͥ������}ɕ������ɽ������}ѥ���х�����(������Q=}Q���U1%1159Q}U1%11}Q}%MP�(������L����}��є�(�������ɑ��}������5Q}%M}I}QI%@����5Q}%M}	%11}Q=}AQ%9P�(������Ae59QM}Q=Q1}=II}5=U9P����Ae59QM}5I%8����Ae59QM}Q=Q1}%M
=U9P�(������%%Q1}
UMQ=5I}Ae59Q}5=U9P����MM%959Q}AI=Y%I}QeA�(������5Q}MIY%
Q%1M}MIY%
QeA��ع��}�����}����(��I=4�	1�
=I�I}	1}=IIM}%90��(��1P�)=%8�	1�
=I�	1}Y!%
1M}Q�؁=8�عٕ�����}���􁘹��ͥ������}���ձ����}��(��1P�)=%8�	1�
=I�	4E��$t䕤D����T�D�D�U5��Uu�d�EDUTB��b��WF�6�FU��B���6�FU��@�t�U$Rb��UD��$u��B�rG��$u��G�p��Bb��UD��$DW%�5DEU2��B���t4�4T��TBr�tD�5UDTBr���Bb��UD��$DU%�E�S�t$�����rp��B�d�T�b��WF�6W'f�6VFWF��5�6W'f�6WG�R�rr��t�%��%T��4Rp��B4��U44R�b��UD��$DU%�E�R�rr��uDU5Bp��B��4�DU�E�U�DU42�tD�t�D�p��BUU"�E$�҆��4�E����2��B�T����B4��U44R� � bD��DDR�4��dU%E�D��U���R�uUD2r�t6����ƶFr�b�76�v��V�E�&V6�VG&��ffE�F��W7F�����D��DDR�b�eT�d����T�E�eT�d���TE�E��5B���$UEtTT�rG��DE5D%G�r�BG��DDT�G�p���4T�T5@�4�E�����5�D���4�UB�v�&FW%��B�2�DE�E$�5�DTĕdU$TB��$�T�B�5T҄44Rt�T��d�T��UD��5�e$TU�E$��d�4R��E%TRD�T�T�4R�d�T���T�E5�D�D���$DU%���T�B���T�B���2�DE�$Ub��$�T�B�5T҄44Rt�T�54�t��T�E�$�d�DU%�E�R�t�t�TBrD�T���T�E5��$t���T�B���2�DE��$t����B��$�T�B�5T҄44Rt�T�54�t��T�E�$�d�DU%�E�W��t�t�TBr�B�d�T��UD��5�e$TU�E$��d�4R���E%TP�D�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B���2�DE������t��$Ub��$�T�B��5T҄44Rt�T�54�t��T�E�$�d�DU%�E�W��t�t�TBrD�T���T�E5��$t���T�B����T�Ĕb�5T҄44Rt�T�54�t��T�E�$�d�DU%�EUR�t�t�TBr�B�d�T��UD��5�e$TU�E$��d�4R���E%TP�D�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B������2�DE��$t���5B��$�T�B�5T҄44Rt�T��UD��5�$����D��$�T�C�E%TR�B�4T�E5�D�D���$DU%���T�C�� ��B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T�D�t�D��5U5EDU%���T�E���T�B���T�B���2�DE�E"��$�T�B��5T҄44Rt�T��UD��5�$����D��D�T�C�E%TR�B��T�E5�D�D���$DU%���T�C� ��B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T�D�t�D��5U5D��U%���T�E���T�B���T�B����T�Ĕb�5T҄44Rt�T��d�T��UD��5�e$TU�E$��d�4R��E%TRD�T�T�4R�d�T���T�E5�D�D���$DU%���T�B���T�B������2�DE�E%�5B��$�T�B�5T҄44Rt�T�&����FV��G�S�t�t�TBr�B�UD�4U%d�4TDUD��5�4U%d�4UE�R��u$�E��%T��4Rr�tDTE�$�E��$�E�E$�5�%Br���B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B���2�DE��t��$�E�$Ub��$�T�B�5T҄44Rt�T��UD�4U%d�4TDUD��5�4U%d�4UE�R��u$�E��%T��4Rr�tDTE�$�E��$�E�E$�5�%Br���B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B���2�DE�$�E�$Ub��$�T�B��5T҄44Rt�T�&����FV��G�S�t�t�TBr�B�UD�4U%d�4TDUD��5�4U%d�4UE�R��u$�E��%T��4Rr�tDTE�$�E��$�E�E$�5�%Br���B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B����T�Ĕb�5T҄44Rt�T��UD�4U%d�4TDUD��5�4U%d�4UE�R��u$�E��%T��4Rr�tDTE�$�E��$�E�E$�5�%Br���B�d�T��UD��5�e$TU�E$��d�4R���E%TRD�T��d�T���T�E5�D�D���$DU%���T�B���T�4RT�B������2�DE��t��$�E�5B��4�UT�B�44Rt�T�f���FFS�rG�F�F��rD�T��&FW%��BT�B�2D�D��E$�2��$�T�B�5T҄44Rt�T�f���FFS�rG�F�F��rD�T�44Rt�T��d�T��UD��5�e$TU�E$��d�4R��E%TRD�T� �T�4R�d�T���T�E5�D�D���$DU%���T�B���T�BT�4RT�B���2D�D��$Ub��4�T�B4�P���S��[��]OI��Y\�\�^_I�S�ܙ\��YS�
HT�QVW��T����S�
�SJ�T�H�S��[��]OI��Y\�\�^_I�S��T�H�S�Q��S
QUW�T�є�QW��T�S�JOU�QHS��S�HQ��S
VSQS����S�ԑT��SS�S�
K�LS�S�HS�
K
HT�QVWԑU�����H�\�B�ԓ�T�H�UK��US����TUQPS���HU��T��SU�T�Q��ԑT��HUԑU�T���S�T�B
