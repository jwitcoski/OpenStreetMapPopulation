/*
 * Unit tests for Overpass mirror failover.
 * Run: node tests/overpass-failover.mjs
 */

import { fetchBuildingsInPolygon, buildBuildingsQuery } from '../scripts/overpass.js';

const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-77.038, 38.895],
      [-77.035, 38.895],
      [-77.035, 38.893],
      [-77.038, 38.893],
      [-77.038, 38.895],
    ],
  ],
};

const endpoints = [
  'https://mirror-a.example/api',
  'https://mirror-b.example/api',
  'https://mirror-c.example/api',
];

let calls = 0;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url) => {
  calls += 1;
  if (calls === 1) {
    return { ok: false, status: 504, json: async () => ({}) };
  }
  if (calls === 2) {
    return { ok: false, status: 503, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      elements: [
        {
          type: 'way',
          tags: { building: 'house' },
          center: { lon: -77.036, lat: 38.894 },
        },
      ],
    }),
  };
};

const statuses = [];
const result = await fetchBuildingsInPolygon(geometry, {
  endpoints,
  onStatus: (message) => statuses.push(message),
});

globalThis.fetch = originalFetch;

assert(calls === 3, `expected 3 mirror attempts, got ${calls}`);
assert(result.counts.total === 1, 'classified one house');
assert(result.buildings.length === 1, 'one heatmap point');
assert(
  statuses.some((s) => /mirror/i.test(s)),
  'should announce mirror retries'
);
assert(
  buildBuildingsQuery('1 2 3 4').includes('[timeout:25]'),
  'query uses shorter timeout'
);

console.log('PASS overpass failover', { calls, statuses, counts: result.counts });

// Exhausted mirrors should surface a clear busy message.
calls = 0;
globalThis.fetch = async () => ({ ok: false, status: 504, json: async () => ({}) });
let failed = null;
try {
  await fetchBuildingsInPolygon(geometry, { endpoints: endpoints.slice(0, 2) });
} catch (error) {
  failed = error;
}
globalThis.fetch = originalFetch;

assert(failed, 'should throw when all mirrors fail');
assert(/busy|504/i.test(failed.message), `friendly message, got: ${failed.message}`);
console.log('PASS overpass exhausted mirrors message');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}
