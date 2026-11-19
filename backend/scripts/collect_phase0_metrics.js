'use strict';

/**
 * Low-rate, read-only Prometheus snapshot collector for the Phase 0 baseline.
 *
 * Required environment variables:
 *   GLOWAPP_METRICS_URL    HTTPS URL for the GlowApp /metrics endpoint.
 *   GLOWAPP_METRICS_OUTPUT Absolute path to an NDJSON output file.
 * Optional:
 *   GLOWAPP_METRICS_INTERVAL_MS (default 60000, minimum 15000).
 *
 * Only bounded application metrics are persisted. No response bodies, headers,
 * authentication material, or business payloads are written to the output.
 */
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const allowedHosts = new Set([
  'glowapp-api-production.up.railway.app',
  'glowapp-api-staging-staging.up.railway.app',
]);
const metricNamePattern = /^glowapp_(?:up|db_available|db_degraded|http_requests_total|http_request_duration_seconds_(?:bucket|sum|count)|process_[a-zA-Z0-9_:]+|nodejs_[a-zA-Z0-9_:]+|eventloop_[a-zA-Z0-9_:]+)$/;

function readConfig() {
  const target = process.env.GLOWAPP_METRICS_URL;
  const output = process.env.GLOWAPP_METRICS_OUTPUT;
  if (!target || !output) {
    throw new Error('Set GLOWAPP_METRICS_URL and GLOWAPP_METRICS_OUTPUT before starting the collector.');
  }

  const url = new URL(target);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.pathname !== '/metrics' || url.search || url.hash || url.username || url.password) {
    throw new Error('Target must be HTTPS /metrics on an approved GlowApp Railway API host, without credentials or query parameters.');
  }

  const requestedInterval = Number(process.env.GLOWAPP_METRICS_INTERVAL_MS || 60000);
  if (!Number.isInteger(requestedInterval) || requestedInterval < 15000 || requestedInterval > 300000) {
    throw new Error('GLOWAPP_METRICS_INTERVAL_MS must be an integer from 15000 to 300000.');
  }

  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  return { url, outputPath, intervalMs: requestedInterval, once: process.env.GLOWAPP_METRICS_ONCE === '1' };
}

function parseMetricLine(line) {
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)(?:\s+\d+)?\s*$/);
  if (!match || !metricNamePattern.test(match[1])) return null;

  const labels = {};
  const labelText = match[2] || '';
  const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  for (const labelMatch of labelText.matchAll(labelPattern)) {
    labels[labelMatch[1]] = labelMatch[2].replace(/\\([\\"])/g, '$1').replace(/\\n/g, '\n');
  }

  return { name: match[1], labels, value: match[3] };
}

function extractMetrics(body) {
  return body.split(/\r?\n/).map(parseMetricLine).filter(Boolean);
}

async function main() {
  const config = readConfig();
  const file = fs.createWriteStream(config.outputPath, { flags: 'a', encoding: 'utf8' });
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  console.log(`Collecting ${config.url.origin}/metrics every ${config.intervalMs} ms.`);
  console.log(`Writing selected metric snapshots to ${config.outputPath}.`);

  while (!stopping) {
    const startedAt = Date.now();
    let record;
    try {
      const response = await fetch(config.url, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'text/plain; version=0.0.4', 'user-agent': 'GlowApp-Phase0-Metrics-Collector/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`metrics endpoint returned HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/plain')) throw new Error(`unexpected metrics content type: ${contentType}`);

      const body = await response.text();
      record = {
        collectedAt: new Date().toISOString(),
        targetHost: config.url.hostname,
        status: 'ok',
        metrics: extractMetrics(body),
      };
      console.log(`${record.collectedAt} scraped ${record.metrics.length} selected metric samples.`);
    } catch (error) {
      const causeCode = error && error.cause && error.cause.code;
      record = {
        collectedAt: new Date().toISOString(),
        targetHost: config.url.hostname,
        status: 'error',
        error: `${String(error && error.message || error)}${causeCode ? ` (${causeCode})` : ''}`.slice(0, 240),
      };
      console.error(`${record.collectedAt} scrape failed: ${record.error}`);
    }

    if (!file.write(`${JSON.stringify(record)}\n`)) {
      await new Promise((resolve) => file.once('drain', resolve));
    }
    if (config.once) break;
    const remaining = Math.max(0, config.intervalMs - (Date.now() - startedAt));
    if (!stopping && remaining > 0) await delay(remaining);
  }

  await new Promise((resolve) => file.end(resolve));
  console.log('Collector stopped cleanly.');
}

if (require.main === module) {
  try {
    main().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { extractMetrics, parseMetricLine };
