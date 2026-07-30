/*
 * overpass.js
 * Talks to the Overpass API: turn a drawn polygon into OSM building results.
 *
 * Public Overpass instances rate-limit aggressively (429) and sometimes
 * return 504 when busy. We:
 *   - cache recent polygon results (avoids repeat downloads)
 *   - enforce a client-side gap between live requests
 *   - on 429, wait (Retry-After) instead of blasting every mirror
 *   - on 502/503/504, fail over to an independent mirror after a pause
 *   - never treat gateway failures as “no buildings”
 */

import { OVERPASS_URLS } from './config.js';
import { classifyBuildings } from './classify-buildings.js';

/** HTTP statuses that mean "try another server later". */
const FAILOVER_STATUS = new Set([502, 503, 504]);

/** Minimum time between live Overpass calls from this browser tab. */
const MIN_REQUEST_GAP_MS = 8000;

/** How long cached polygon results stay valid. */
const CACHE_TTL_MS = 15 * 60 * 1000;

/** @type {Map<string, { savedAt: number, result: object }>} */
const resultCache = new Map();

/** Timestamp of the last live (non-cache) Overpass request start. */
let lastLiveRequestAt = 0;

export const OVERPASS_FAILED = 'OVERPASS_FAILED';

/**
 * @param {string} message
 * @param {{ status?: number, retryAfter?: string | null, cause?: unknown }} [extras]
 */
export function createOverpassError(message, extras = {}) {
  const error = new Error(message);
  error.name = 'OverpassError';
  error.code = OVERPASS_FAILED;
  error.retryable = true;
  if (extras.status != null) error.status = extras.status;
  if (extras.retryAfter != null) error.retryAfter = extras.retryAfter;
  if (extras.cause != null) error.cause = extras.cause;
  return error;
}

/**
 * Convert a GeoJSON polygon into Overpass poly:"lat lon lat lon ..." syntax.
 * Overpass expects latitude first (opposite of GeoJSON).
 */
export function polygonToOverpassPoly(geometry) {
  const ring = geometry.coordinates[0];
  const simplified = simplifyRing(ring, 40);
  return simplified
    .map(([longitude, latitude]) => `${latitude} ${longitude}`)
    .join(' ');
}

/**
 * Build the Overpass QL query that selects buildings inside a polygon.
 */
export function buildBuildingsQuery(polyString) {
  return `
[out:json][timeout:25];
(
  way["building"](poly:"${polyString}");
  relation["building"](poly:"${polyString}");
);
out tags center;
`.trim();
}

/**
 * Fetch OSM buildings inside a GeoJSON polygon.
 * Returns classified counts plus per-building centers for the heatmap.
 *
 * @param {object} geometry - GeoJSON Polygon geometry
 * @param {{
 *   signal?: AbortSignal,
 *   onStatus?: (message: string) => void,
 *   endpoints?: string[],
 *   now?: () => number,
 * }} [options]
 */
export async function fetchBuildingsInPolygon(
  geometry,
  {
    signal,
    onStatus,
    endpoints = OVERPASS_URLS,
    now = () => Date.now(),
  } = {}
) {
  const polyString = polygonToOverpassPoly(geometry);
  const cacheKey = polyString;
  const cached = resultCache.get(cacheKey);

  if (cached && now() - cached.savedAt < CACHE_TTL_MS) {
    onStatus?.('Using cached building data for this area…');
    return cached.result;
  }

  // Space out live requests so we do not trip Overpass rate limits.
  const gap = MIN_REQUEST_GAP_MS - (now() - lastLiveRequestAt);
  if (gap > 0) {
    onStatus?.(
      `Waiting ${Math.ceil(gap / 1000)}s to respect Overpass rate limits…`
    );
    await wait(gap, signal);
  }

  const query = buildBuildingsQuery(polyString);
  const body = `data=${encodeURIComponent(query)}`;

  let lastError = null;

  for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const endpoint = endpoints[attempt];
    if (attempt === 0) {
      onStatus?.('Querying OpenStreetMap buildings…');
    } else {
      onStatus?.(
        `Trying another Overpass server (${attempt + 1}/${endpoints.length})…`
      );
      await wait(1500 * attempt, signal);
    }

    try {
      lastLiveRequestAt = now();
      const { data } = await postOverpass(endpoint, body, signal);

      if (data.remark || data.error) {
        lastError = createOverpassError(
          String(data.remark || data.error),
          { status: 504 }
        );
        continue;
      }

      // A real Overpass success always includes an elements array.
      // Missing/invalid payloads (proxies, HTML-as-JSON failures) are NOT
      // “zero buildings” — treat them as retryable Overpass failures.
      if (!Array.isArray(data.elements)) {
        lastError = createOverpassError(
          'Overpass returned an invalid response.',
          { status: 502 }
        );
        continue;
      }

      const result = classifyBuildings(data.elements);
      resultCache.set(cacheKey, { savedAt: now(), result });
      trimCache();
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;

      if (error.status === 429) {
        const retryAfterMs = retryAfterMilliseconds(error.retryAfter) ?? 12000;
        onStatus?.(
          `Overpass rate limit hit — waiting ${Math.ceil(retryAfterMs / 1000)}s…`
        );
        await wait(retryAfterMs, signal);
        continue;
      }

      if (!isFailoverError(error)) throw error;
    }
  }

  throw finalizeOverpassFailure(lastError);
}

/**
 * POST one Overpass query and parse JSON.
 */
export async function postOverpass(endpoint, body, signal) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        'User-Agent':
          'BuildingPop/2.0 (https://github.com/jwitcoski/OpenStreetMapPopulation)',
      },
      body,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw createOverpassError('Network error contacting Overpass', {
      cause: error,
    });
  }

  if (!response.ok) {
    throw createOverpassError(
      response.status === 504
        ? 'Overpass timed out (504).'
        : `Overpass request failed (${response.status}).`,
      {
        status: response.status,
        retryAfter: response.headers.get('Retry-After'),
      }
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw createOverpassError('Overpass returned a non-JSON response.', {
      status: response.status,
      cause: error,
    });
  }

  return { data, response };
}

/** Clear cached results (used by tests). */
export function clearOverpassCache() {
  resultCache.clear();
  lastLiveRequestAt = 0;
}

function finalizeOverpassFailure(lastError) {
  if (lastError?.status === 429) {
    return createOverpassError(
      'Overpass rate limit (429). Wait about a minute, then try again?',
      { status: 429, retryAfter: lastError.retryAfter }
    );
  }

  const status = lastError?.status;
  const detail =
    status === 504 || /504|timeout|busy/i.test(lastError?.message || '')
      ? 'Overpass timed out or is busy (504).'
      : lastError?.message || 'Overpass request failed.';

  return createOverpassError(
    `Overpass failed to run. ${detail} Do you want to try again?`,
    { status, cause: lastError }
  );
}

function isFailoverError(error) {
  return Boolean(
    error.code === OVERPASS_FAILED ||
      error.retryable ||
      FAILOVER_STATUS.has(error.status) ||
      /504|503|502|timeout|busy|Network error|non-JSON|invalid response/i.test(
        error.message || ''
      )
  );
}

function retryAfterMilliseconds(retryAfter) {
  if (!retryAfter) return null;
  const asSeconds = Number(retryAfter);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
    return Math.min(60000, Math.max(1000, asSeconds * 1000));
  }
  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) {
    return Math.min(60000, Math.max(1000, asDate - Date.now()));
  }
  return null;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function trimCache() {
  if (resultCache.size <= 20) return;
  const oldestKey = resultCache.keys().next().value;
  resultCache.delete(oldestKey);
}

/**
 * Downsample a ring to at most maxPoints (keeps first/last = closed ring).
 */
function simplifyRing(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring;

  const isClosed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];

  const open = isClosed ? ring.slice(0, -1) : ring.slice();
  const keep = Math.max(3, maxPoints - (isClosed ? 1 : 0));
  const step = (open.length - 1) / (keep - 1);
  const sampled = [];

  for (let i = 0; i < keep; i += 1) {
    sampled.push(open[Math.round(i * step)]);
  }

  if (isClosed) sampled.push(sampled[0]);
  return sampled;
}
