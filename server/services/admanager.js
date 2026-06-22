const AD_MANAGER_API = 'https://admanager.googleapis.com/v1';

export async function fetchAdManagerReport({
  accessToken,
  networkCode,
  reportId,
  from,
  to,
  metrics,
  dimensions,
  preferDateDimension = false
}) {
  if (!accessToken || !networkCode || !reportId) return [];

  if ((preferDateDimension || hasDateDimension(dimensions)) && from !== to) {
    try {
      return await fetchReportForRange({
        accessToken,
        networkCode,
        reportId,
        from,
        to,
        metrics,
        dimensions: withDateDimension(dimensions),
        patchColumns: true
      });
    } catch (error) {
      console.warn(`Fast Ad Manager date backfill failed, falling back to daily runs: ${error.message}`);
      return fetchDailySiteReports({
        accessToken,
        networkCode,
        reportId,
        from,
        to,
        metrics,
        dimensions: withoutDateDimension(dimensions)
      });
    }
  }

  if (!hasDateDimension(dimensions) && from !== to) {
    return fetchDailySiteReports({
      accessToken,
      networkCode,
      reportId,
      from,
      to,
      metrics,
      dimensions
    });
  }

  try {
    return await fetchReportForRange({
      accessToken,
      networkCode,
      reportId,
      from,
      to,
      metrics,
      dimensions,
      patchColumns: hasDateDimension(dimensions)
    });
  } catch (error) {
    if (!hasDateDimension(dimensions)) throw error;
    console.warn(`Date-dimension Ad Manager sync failed, falling back to site-only run: ${error.message}`);
    return fetchReportForRange({
      accessToken,
      networkCode,
      reportId,
      from,
      to,
      metrics,
      dimensions: withoutDateDimension(dimensions),
      patchColumns: false
    });
  }
}

async function fetchDailySiteReports({
  accessToken,
  networkCode,
  reportId,
  from,
  to,
  metrics,
  dimensions
}) {
  const rows = [];
  const siteDimensions = withoutDateDimension(dimensions);
  for (const date of listDates(from, to)) {
    rows.push(...await fetchReportForRange({
      accessToken,
      networkCode,
      reportId,
      from: date,
      to: date,
      metrics,
      dimensions: siteDimensions,
      patchColumns: false
    }));
  }
  return rows;
}

async function fetchReportForRange({
  accessToken,
  networkCode,
  reportId,
  from,
  to,
  metrics,
  dimensions,
  patchColumns
}) {
  await updateReportDefinition({
    accessToken,
    networkCode,
    reportId,
    from,
    to,
    dimensions,
    patchColumns
  });
  const operation = await runReport({ accessToken, networkCode, reportId });
  const reportResult = await waitForReportResult({ accessToken, operation });
  const payload = await fetchAllRows({ accessToken, reportResult });

  return normalizeAdManagerRows(payload, {
    range: { from, to },
    metrics,
    dimensions
  });
}

async function updateReportDefinition({
  accessToken,
  networkCode,
  reportId,
  from,
  to,
  dimensions,
  patchColumns = false
}) {
  const report = await getReport({ accessToken, networkCode, reportId });
  const updateMask = ['reportDefinition.dateRange'];
  const shouldPatchDimensions = patchColumns
    && dimensions?.length
    && !sameNormalizedList(report.reportDefinition?.dimensions, dimensions);
  if (shouldPatchDimensions) updateMask.push('reportDefinition.dimensions');

  const reportDefinition = {
    ...(report.reportDefinition || {}),
    dateRange: fixedDateRange(from, to)
  };
  if (shouldPatchDimensions) reportDefinition.dimensions = dimensions;

  const response = await fetch(`${AD_MANAGER_API}/networks/${networkCode}/reports/${reportId}?updateMask=${updateMask.join(',')}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: report.name || `networks/${networkCode}/reports/${reportId}`,
      reportDefinition
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error('Reconnect Google Ad Manager. Exact date sync requires the admanager OAuth scope.');
    }
    throw new Error(`Ad Manager report date update failed: ${response.status} ${detail}`);
  }
}

async function getReport({ accessToken, networkCode, reportId }) {
  const response = await fetch(`${AD_MANAGER_API}/networks/${networkCode}/reports/${reportId}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`Ad Manager report lookup failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
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

function fixedDateRange(from, to) {
  return {
    fixed: {
      startDate: googleDate(from),
      endDate: googleDate(to)
    }
  };
}

function googleDate(value) {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  };
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
    'AD_EXCHANGE_AVERAGE_ECPM',
    'TOTAL_IMPRESSIONS'
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
    const reportedImpressions = metric(
      'TOTAL_IMPRESSIONS',
      'IMPRESSIONS',
      'AD_EXCHANGE_IMPRESSIONS',
      'AD_SERVER_IMPRESSIONS',
      'AD_EXCHANGE_RESPONSES_SERVED'
    );
    const calculatedImpressions = earnings > 0 && adxEcpm > 0 ? Math.round((earnings / adxEcpm) * 1000) : 0;
    const impressions = reportedImpressions || calculatedImpressions;
    const reportedClicks = metric('CLICKS', 'AD_EXCHANGE_CLICKS');
    const calculatedClicks = impressions > 0 && adxCtr > 0 ? Math.round((impressions * adxCtr) / 100) : 0;
    const pageViews = metric('PAGE_VIEWS', 'AD_EXCHANGE_PAGE_VIEWS') || impressions;

    return {
      date,
      domain: cleanDomain(domain),
      earnings,
      pageViews,
      activeUsers: 0,
      clicks: reportedClicks || calculatedClicks,
      impressions,
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

function hasDateDimension(dimensions = []) {
  return dimensions.some((dimension) => normalizeName(dimension) === 'DATE');
}

function withDateDimension(dimensions = []) {
  const cleanDimensions = dimensions.filter(Boolean);
  if (hasDateDimension(cleanDimensions)) return cleanDimensions;
  return ['DATE', ...cleanDimensions];
}

function withoutDateDimension(dimensions = []) {
  const cleanDimensions = dimensions.filter((dimension) => normalizeName(dimension) !== 'DATE');
  return cleanDimensions.length ? cleanDimensions : ['SITE'];
}

function sameNormalizedList(left = [], right = []) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return left.every((item, index) => normalizeName(item) === normalizeName(right[index]));
}

function listDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.length ? dates : [to];
}
