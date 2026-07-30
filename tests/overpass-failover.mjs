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

assert(failed, 'should throw when still rate limited');
assert(/429|rate limit/i.test(failed.message), failed.message);
assert(failed.code === 'OVERPASS_FAILED', 'should use OVERPASS_FAILED code');
assert(/try again/i.test(failed.message), failed.message);
assert(!/no buildings/i.test(failed.message), '429 must not say no buildings');
console.log('PASS overpass 429 exhausted message');

// 429 then empty 200 must NOT become “no buildings”
clearOverpassCache();
calls = 0;
now = 2_500_000;
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
    json: async () => ({ elements: [] }),
  };
};

let failedEmptyAfter429 = null;
try {
  await fetchBuildingsInPolygon(geometry, {
    endpoints: [endpoints[0]],
    now: () => now,
  });
} catch (error) {
  failedEmptyAfter429 = error;
}

assert(failedEmptyAfter429, 'empty after 429 should throw');
assert(failedEmptyAfter429.code === 'OVERPASS_FAILED', 'empty-after-429 code');
assert(/429|rate limit/i.test(failedEmptyAfter429.message), failedEmptyAfter429.message);
assert(
  !/no buildings/i.test(failedEmptyAfter429.message),
  'empty after 429 must not say no buildings'
);
console.log('PASS overpass empty-after-429 is failure');

// Exhausted 504s must NOT look like “no buildings”
clearOverpassCache();
calls = 0;
now = 3_000_000;
globalThis.fetch = async () => ({
  ok: false,
  status: 504,
  headers: { get: () => null },
  json: async () => ({ error: 'Gateway Timeout' }),
});

let failed504 = null;
try {
  await fetchBuildingsInPolygon(geometry, {
    endpoints,
    now: () => now,
  });
} catch (error) {
  failed504 = error;
}

// Invalid success payload (no elements array) is also a failure, not empty.
clearOverpassCache();
calls = 0;
now = 4_000_000;
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({}),
});

let failedInvalid = null;
try {
  await fetchBuildingsInPolygon(geometry, {
    endpoints: [endpoints[0]],
    now: () => now,
  });
} catch (error) {
  failedInvalid = error;
}

// Genuine empty area (no prior 429) is allowed.
clearOverpassCache();
calls = 0;
now = 5_000_000;
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ elements: [] }),
});

const genuineEmpty = await fetchBuildingsInPolygon(geometry, {
  endpoints: [endpoints[0]],
  now: () => now,
});

globalThis.fetch = originalFetch;

assert(failed504, 'should throw on 504');
assert(failed504.code === 'OVERPASS_FAILED', '504 code');
assert(/Overpass failed to run/i.test(failed504.message), failed504.message);
assert(/try again/i.test(failed504.message), failed504.message);
assert(!/no buildings/i.test(failed504.message), '504 must not say no buildings');

assert(failedInvalid, 'should throw on invalid JSON payload');
assert(failedInvalid.code === 'OVERPASS_FAILED', 'invalid payload code');
assert(!/no buildings/i.test(failedInvalid.message), 'invalid must not say no buildings');

assert(genuineEmpty.counts.total === 0, 'genuine empty area still allowed');

console.log('PASS overpass 504 + invalid + genuine-empty messaging');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}
