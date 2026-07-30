/*
 * Unit tests for Overpass caching, rate-gap, and 429 handling.
 * Run: node tests/overpass-failover.mjs
 */

import {
  fetchBuildingsInPolygon,
  clearOverpassCache,
  buildBuildingsQuery,
} from '../scripts/overpass.js';

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
];

clearOverpassCache();

let calls = 0;
let now = 1_000_000;
const originalFetch = globalThis.fetch;

globalThis.fetch = async () => {
  calls += 1;
  if (calls === 1) {
    return {
      ok: false,
      status: 429,
      headers: { get: (name) => (name === 'Retry-After' ? '1' : null) },
      json: async () => ({}),
    };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
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
  now: () => now,
});

assert(calls === 2, `expected 2 attempts after 429 wait, got ${calls}`);
assert(result.counts.houses === 1, 'classified house');
assert(
  statuses.some((s) => /rate limit/i.test(s)),
  'should announce rate-limit wait'
);

// Second identical query should hit cache (no new fetch).
const callsBeforeCache = calls;
now += 1000;
const statuses2 = [];
const cached = await fetchBuildingsInPolygon(geometry, {
  endpoints,
  onStatus: (message) => statuses2.push(message),
  now: () => now,
});
assert(calls === callsBeforeCache, 'cache should avoid a live request');
assert(cached.counts.houses === 1, 'cached counts');
assert(
  statuses2.some((s) => /cached/i.test(s)),
  'should announce cache use'
);

assert(
  buildBuildingsQuery('1 2').includes('[timeout:25]'),
  'query timeout present'
);

console.log('PASS overpass 429 + cache', { calls, statuses, statuses2 });

// Exhausted 429s
clearOverpassCache();
calls = 0;
now = 2_000_000;
globalThis.fetch = async () => ({
  ok: false,
  status: 429,
  headers: { get: (name) => (name === 'Retry-After' ? '1' : null) },
  json: async () => ({}),
});

let failed = null;
try {
  await fetchBuildingsInPolygon(geometry, {
    endpoints: [endpoints[0]],
    now: () => now,
  });
} catch (error) {
  failed = error;
}
globalThis.fetch = originalFetch;

assert(failed, 'should throw when still rate limited');
assert(/429|rate limit/i.test(failed.message), failed.message);
console.log('PASS overpass 429 exhausted message');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}
