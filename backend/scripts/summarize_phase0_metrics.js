'use strict';

/** Summarize NDJSON snapshots produced by collect_phase0_metrics.js. */
const fs = require('node:fs');
const path = require('node:path');

function seriesKey(metric, labelNames) {
  const labels = labelNames.map((name) => `${name}=${metric.labels[name] || ''}`).join('|');
  return `${metric.name}|${labels}`;
}

function snapshotMap(record, names) {
  return new Map((record.metrics || [])
    .filter((metric) => names.has(metric.name))
    .map((metric) => [seriesKey(metric, Object.keys(metric.labels).sort()), metric]));
}

function quantile(buckets, q) {
  const finite = [...buckets.entries()]
    .filter(([le]) => Number.isFinite(Number(le)))
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const count = buckets.get('+Inf') || 0;
  if (!count) return null;
  const target = q * count;
  let previousBound = 0;
  let previousCount = 0;
  for (const [boundText, cumulative] of finite) {
    const bound = Number(boundText);
    if (cumulative >= target) {
      const bucketCount = cumulative - previousCount;
      if (bucketCount <= 0) return bound;
      const fraction = (target - previousCount) / bucketCount;
      return previousBound + (bound - previousBound) * fraction;
    }
    previousBound = bound;
    previousCount = cumulative;
  }
  return '>10s';
}

function readRecords(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`); }
  });
}

function summarize(filePath) {
  const records = readRecords(filePath);
  const okRecords = records.filter((record) => record.status === 'ok' && Array.isArray(record.metrics));
  const errors = records.length - okRecords.length;
  const maxGapMs = Number(process.env.GLOWAPP_METRICS_MAX_GAP_MS || 600000);
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new Error('GLOWAPP_METRICS_MAX_GAP_MS must be a positive number.');
  const requestsName = 'glowapp_http_requests_total';
  const bucketName = 'glowapp_http_request_duration_seconds_bucket';
  const routeTotals = new Map();
  let intervalCount = 0;
  let skippedLongIntervals = 0;

  for (let index = 1; index < okRecords.length; index += 1) {
    const previous = okRecords[index - 1];
    const current = okRecords[index];
    const previousRequests = snapshotMap(previous, new Set([requestsName]));
    const currentRequests = snapshotMap(current, new Set([requestsName]));
    const previousBuckets = snapshotMap(previous, new Set([bucketName]));
    const currentBuckets = snapshotMap(current, new Set([bucketName]));
    const timeDelta = Date.parse(current.collectedAt) - Date.parse(previous.collectedAt);
    if (!(timeDelta > 0)) continue;
    if (timeDelta > maxGapMs) {
      skippedLongIntervals += 1;
      continue;
    }
    intervalCount += 1;

    for (const [key, metric] of currentRequests) {
      const route = metric.labels.route || 'UNKNOWN';
      if (route === '/metrics' || route === '/api/health' || route === 'UNMATCHED') continue;
      const previousMetric = previousRequests.get(key);
      const nowValue = Number(metric.value);
      const beforeValue = previousMetric ? Number(previousMetric.value) : 0;
      const delta = nowValue >= beforeValue ? nowValue - beforeValue : nowValue;
      const groupKey = `${metric.labels.method || 'UNKNOWN'} ${route}`;
      const row = routeTotals.get(groupKey) || { requests: 0, errors5xx: 0, buckets: new Map() };
      row.requests += delta;
      if (/^5\d\d$/.test(metric.labels.status_code || '')) row.errors5xx += delta;
      routeTotals.set(groupKey, row);
    }

    for (const [key, metric] of currentBuckets) {
      const route = metric.labels.route || 'UNKNOWN';
      if (route === '/metrics' || route === '/api/health' || route === 'UNMATCHED') continue;
      const previousMetric = previousBuckets.get(key);
      const nowValue = Number(metric.value);
      const beforeValue = previousMetric ? Number(previousMetric.value) : 0;
      const delta = nowValue >= beforeValue ? nowValue - beforeValue : nowValue;
      const groupKey = `${metric.labels.method || 'UNKNOWN'} ${route}`;
      const row = routeTotals.get(groupKey) || { requests: 0, errors5xx: 0, buckets: new Map() };
      const le = metric.labels.le || '+Inf';
      row.buckets.set(le, (row.buckets.get(le) || 0) + delta);
      routeTotals.set(groupKey, row);
    }
  }

  const routes = [...routeTotals.entries()].map(([route, row]) => ({
    route,
    requests: row.requests,
    errors5xx: row.errors5xx,
    errorRate5xx: row.requests ? row.errors5xx / row.requests : null,
    p50Seconds: quantile(row.buckets, 0.50),
    p95Seconds: quantile(row.buckets, 0.95),
    p99Seconds: quantile(row.buckets, 0.99),
  })).sort((a, b) => b.requests - a.requests);

  return {
    source: path.resolve(filePath),
    windowStart: okRecords[0]?.collectedAt || null,
    windowEnd: okRecords.at(-1)?.collectedAt || null,
    scrapeSamples: records.length,
    successfulSamples: okRecords.length,
    failedSamples: errors,
    intervalsAnalyzed: intervalCount,
    skippedLongIntervals,
    excludedSyntheticRoutes: ['/metrics', '/api/health', 'UNMATCHED'],
    routes,
    note: 'Histogram percentiles are estimates from bucket deltas. Validate enough traffic and histogram resolution before treating them as an SLA.',
  };
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node backend/scripts/summarize_phase0_metrics.js <metrics.ndjson>');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(`${JSON.stringify(summarize(filePath), null, 2)}\n`); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { quantile, summarize };
