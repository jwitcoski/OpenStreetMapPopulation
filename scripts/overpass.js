/*
 * overpass.js
 * Talks to the Overpass API: turn a drawn polygon into OSM building results.
 *
 * Public Overpass instances often return 504 when busy. We try several
 * mirrors and retry transient failures before giving up.
 */

import { OVERPASS_URLS } from './config.js';
import { classifyBuildings } from './classify-buildings.js';

/** HTTP statuses worth retrying on another mirror / later attempt. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Convert a GeoJSON polygon into Overpass poly:"lat lon lat lon ..." syntax.
 * Overpass expects latitude first (opposite of GeoJSON).
 */
export function polygonToOverpassPoly(geometry) {
  const ring = geometry.coordinates[0];
  // Keep rings short — huge vertex lists slow Overpass poly filters.
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
 * }} [options]
 */
export async function fetchBuildingsInPolygon(
  geometry,
  { signal, onStatus, endpoints = OVERPASS_URLS } = {}
) {
  const polyString = polygonToOverpassPoly(geometry);
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
        `Overpass server busy — trying mirror ${attempt + 1}/${endpoints.length}…`
      );
      await wait(400 * attempt, signal);
    }

    try {
      const data = await postOverpass(endpoint, body, signal);
      if (data.remark) {
        // Timeout / memory remarks are often transient — try next mirror.
        lastError = new Error(data.remark);
        continue;
      }
      return classifyBuildings(data.elements ?? []);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
      if (!isRetryableError(error)) throw error;
    }
  }

  throw new Error(
    lastError?.message?.includes('504') || lastError?.status === 504
      ? 'Overpass servers are busy (504). Wait a few seconds and try again.'
      : lastError?.message ||
          'Overpass servers are busy. Wait a few seconds and try again.'
  );
}

/**
 * POST one Overpass query and parse JSON.
 * @throws {{ status?: number, message: string, name?: string }}
 */
export async function postOverpass(endpoint, body, signal) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        // Overpass asks for an identifying UA; browsers already send one and
        // may ignore this header, which is fine.
        'User-Agent':
          'BuildingPop/2.0 (https://github.com/jwitcoski/OpenStreetMapPopulation)',
      },
      body,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const wrapped = new Error(`Network error contacting Overpass (${endpoint})`);
    wrapped.cause = error;
    wrapped.retryable = true;
    throw wrapped;
  }

  if (!response.ok) {
    const error = new Error(`Overpass request failed (${response.status})`);
    error.status = response.status;
    error.retryable = RETRYABLE_STATUS.has(response.status);
    throw error;
  }

  return response.json();
}

function isRetryableError(error) {
  return Boolean(
    error.retryable ||
      RETRYABLE_STATUS.has(error.status) ||
      /504|503|502|429|timeout|busy|Network error/i.test(error.message || '')
  );
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
