const AD_MANAGER_API = 'https://admanager.googleapis.com/v1';

export async function fetchAdManagerReport({
  accessToken,
  networkCode,
  reportId,
  from,
  to,
  metrics,
  dimensions
}) {
  if (!accessToken || !networkCode || !reportId) return [];

  const operation = await runReport({ accessToken, networkCode, reportId });
  const reportResult = await waitForReportResult({ accessToken, operation });
  const payload = await fetchAllRows({ accessToken, reportResult });

  return normalizeAdManagerRows(payload, {
    range: { from, to },
    metrics,
    dimensions
  });
}

async function runReport({ accessToken, networkCode, reportId }) {
  const response = await fetch(`${AD_MANAGER_API}/networks/${networkCode}/reports/${reportId}:run`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error(`Ad Manager report run failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForReportResult({ accessToken, operation }) {
  const operationName = operation.name;
  if (!operationName) throw new Error('Ad Manager did not return an operation name');

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${AD_MANAGER_API}/${operationName}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Ad Manager operation polling failed: ${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    if (payload.done) {
      if (payload.error) throw new Error(`Ad Manager report failed: ${payload.error.message || 'unknown error'}`);
      const reportResult = payload.response?.reportResult;
      if (!reportResult) throw new Error('Ad Manager report finished without a result resource');
      return reportResult;
    }
    await delay(1000 + attempt * 250);
  }
  throw new Error('Ad Manager report timed out');
}

async function fetchAllRows({ accessToken, reportResult }) {
  const rows = [];
  let nextPageToken = '';
  let firstPayload = null;

  do {
    const params = new URLSearchParams();
    if (nextPageToken) params.set('pageToken', nextPageToken);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${AD_MANAGER_API}/${reportResult}:fetchRows${suffix}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Ad Manager row fetch failed: ${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    firstPayload ||= payload;
    rows.push(...(payload.rows || []));
    nextPageToken = payload.nextPageToken || '';
  } while (nextPageToken);

  return { ...(firstPayload || {}), rows };
}

export function normalizeAdManagerRows(payload, options = {}) {
  const rows = payload.rows || [];
  const dimensions = options.dimensions?.length ? options.dimensions : readHeaderNames(payload.dimensionHeaders) || ['SITE'];
  const metrics = options.metrics?.length ? options.metrics : readHeaderNames(payload.metricHeaders) || [
    'REVENUE',
    'AD_EXCHANGE_CTR',
    'AD_EXCHANGE_AVERAGE_ECPM'
  ];
  const metricNames = metrics.map(normalizeName);
  const dimensionNames = dimensions.map(normalizeName);
  const fallbackDate = options.range?.to || new Date().toISOString().slice(0, 10);

  return rows.map((row) => {
    const dimensionValues = flattenValues(
      row.dimensionValues || row.dimension_values || row.dimensionValueGroups || row.dimensionValueGroup || row.dimensions
    );
    const metricValues = flattenValues(
      row.metricValues || row.metric_values || row.metricValueGroups || row.metricValueGroup || row.metrics
    );

    const dimension = (name) => valueByName(row, name) || dimensionValues[dimensionNames.indexOf(normalizeName(name))] || '';
    const metric = (...names) => {
      for (const name of names) {
        const named = valueByName(row, name);
        if (named !== '') return parseMetricNumber(named);
        const index = metricNames.indexOf(normalizeName(name));
        if (index >= 0) return parseMetricNumber(metricValues[index]);
      }
      return 0;
    };

    const domain = dimension('SITE') || dimension('DOMAIN_NAME') || dimension('URL') || dimensionValues[0] || '';
    const date = normalizeDate(dimension('DATE') || fallbackDate);
    const earnings = metric('REVENUE', 'TOTAL_REVENUE', 'AD_EXCHANGE_REVENUE', 'ESTIMATED_EARNINGS');
    const adxCtr = metric('AD_EXCHANGE_CTR', 'CTR');
    const adxEcpm = metric('AD_EXCHANGE_AVERAGE_ECPM', 'AD_EXCHANGE_ECPM', 'AVERAGE_ECPM', 'ECPM');
    const pageViews = metric('PAGE_VIEWS', 'AD_EXCHANGE_PAGE_VIEWS', 'IMPRESSIONS');

    return {
      date,
      domain: cleanDomain(domain),
      earnings,
      pageViews,
      activeUsers: 0,
      clicks: metric('CLICKS', 'AD_EXCHANGE_CLICKS'),
      impressions: metric('IMPRESSIONS', 'AD_EXCHANGE_IMPRESSIONS'),
      rpm: adxEcpm,
      adxCtr,
      adxEcpm
    };
  }).filter((row) => row.domain);
}

function readHeaderNames(headers) {
  if (!Array.isArray(headers) || !headers.length) return null;
  return headers.map((header) => header.name || header.apiName || header.field || header.displayName).filter(Boolean);
}

function valueByName(object, name) {
  const wanted = normalizeName(name);
  for (const [key, value] of Object.entries(object || {})) {
    if (normalizeName(key) === wanted) return extractCellValue(value);
  }
  return '';
}

function flattenValues(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap((item) => flattenValues(item));
  if (typeof input !== 'object') return [String(input)];

  if (Array.isArray(input.values)) return input.values.flatMap((item) => flattenValues(item));
  if (Array.isArray(input.metricValues)) return input.metricValues.flatMap((item) => flattenValues(item));
  if (Array.isArray(input.dimensionValues)) return input.dimensionValues.flatMap((item) => flattenValues(item));

  const value = extractCellValue(input);
  return value === '' ? Object.values(input).flatMap((item) => flattenValues(item)) : [value];
}

function extractCellValue(cell) {
  if (cell == null) return '';
  if (typeof cell !== 'object') return String(cell);
  for (const key of [
    'value',
    'stringValue',
    'displayValue',
    'doubleValue',
    'intValue',
    'longValue',
    'microsValue',
    'decimalValue'
  ]) {
    if (cell[key] != null) {
      if (key === 'microsValue') return String(Number(cell[key]) / 1_000_000);
      return String(cell[key]);
    }
  }
  return '';
}

function parseMetricNumber(value) {
  const raw = extractCellValue(value).trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const number = Number(cleaned || 0);
  return negative ? -number : number;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw || new Date().toISOString().slice(0, 10);
}

function cleanDomain(value) {
  return String(value || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
