/*
 * search.js
 * City / area search via Photon (OpenStreetMap geocoder).
 */

import { PHOTON_URL, SEARCH_ZOOM } from './config.js';

/**
 * Search for places matching a free-text query.
 * @param {string} query
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{ label: string, longitude: number, latitude: number }>>}
 */
export async function searchPlaces(query, { signal } = {}) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'en');

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Place search failed (${response.status})`);
  }

  const data = await response.json();
  return (data.features ?? []).map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    return {
      label: formatPlaceLabel(feature.properties ?? {}),
      longitude,
      latitude,
    };
  });
}

function formatPlaceLabel(properties) {
  const parts = [
    properties.name,
    properties.city,
    properties.state,
    properties.country,
  ].filter(Boolean);

  // De-duplicate consecutive repeats (e.g. name === city).
  return [...new Set(parts)].join(', ');
}

/**
 * Wire the search box UI and fly the map to selected results.
 * @param {maplibregl.Map} map
 */
export function initPlaceSearch(map) {
  const form = document.getElementById('place-search-form');
  const input = document.getElementById('place-search-input');
  const resultsList = document.getElementById('place-search-results');

  let abortController = null;
  let debounceTimer = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(input.value);
  });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(input.value), 280);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearResults();
      input.blur();
    }
  });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) clearResults();
  });

  async function runSearch(query) {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      const places = await searchPlaces(query, {
        signal: abortController.signal,
      });
      renderResults(places);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      resultsList.innerHTML =
        '<li class="place-search__empty">Search failed. Try again.</li>';
      resultsList.hidden = false;
    }
  }

  function renderResults(places) {
    if (!places.length) {
      if (input.value.trim().length < 2) {
        clearResults();
        return;
      }
      resultsList.innerHTML =
        '<li class="place-search__empty">No places found.</li>';
      resultsList.hidden = false;
      return;
    }

    resultsList.innerHTML = places
      .map(
        (place, index) => `
        <li>
          <button type="button" class="place-search__result" data-index="${index}">
            ${escapeHtml(place.label)}
          </button>
        </li>`
      )
      .join('');
    resultsList.hidden = false;

    resultsList.querySelectorAll('.place-search__result').forEach((button) => {
      button.addEventListener('click', () => {
        const place = places[Number(button.dataset.index)];
        if (!place) return;
        map.flyTo({
          center: [place.longitude, place.latitude],
          zoom: SEARCH_ZOOM,
          essential: true,
        });
        input.value = place.label;
        clearResults();
      });
    });
  }

  function clearResults() {
    resultsList.innerHTML = '';
    resultsList.hidden = true;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
