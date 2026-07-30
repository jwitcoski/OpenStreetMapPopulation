/*
 * main.js
 * App entry point — wires map drawing to Overpass + population estimate.
 *
 * File map:
 *   styles/*                  CSS
 *   scripts/config.js         Zoom limits and building-type lists
 *   scripts/map.js            MapLibre map helpers
 *   scripts/draw-polygon.js   Simple polygon drawing (no MapboxDraw)
 *   scripts/search.js         City / area search
 *   scripts/overpass.js       Fetch buildings from Overpass
 *   scripts/classify-buildings.js
 *   scripts/population.js
 *   scripts/panel.js
 */

import '../styles/variables.css';
import '../styles/layout.css';
import '../styles/panel.css';
import '../styles/search.css';
import '../styles/draw-controls.css';

import { TOOL_MIN_ZOOM } from './config.js';
import {
  assertCityScaleArea,
  attachPolygonDrawer,
  createMap,
  isToolZoomOk,
  setToolEnabled,
} from './map.js';
import { fetchBuildingsInPolygon } from './overpass.js';
import { estimatePopulation } from './population.js';
import { createPopulationHeatmap } from './heatmap.js';
import {
  initPanel,
  loadPresets,
  renderStats,
  setStatus,
} from './panel.js';
import { initPlaceSearch } from './search.js';

/** Last successful building counts (used when form inputs change). */
let latestCounts = null;

/** Last building records for heatmap re-weighting. */
let latestBuildings = [];

/** Last measured polygon area in km². */
let latestAreaKm2 = null;

/** AbortController for the in-flight Overpass request. */
let activeController = null;

/** Prevent overlapping estimate runs. */
let estimateInFlight = false;

const TOOL_DISABLED_NOTE =
  `Zoom in to city level (z${TOOL_MIN_ZOOM}+) to draw. Overpass can only handle city-sized areas — not regions or countries.`;

async function main() {
  const presets = await loadPresets();
  const { readParams } = initPanel(presets, {
    onParamsChange: recomputeFromParams,
  });

  const { map } = createMap('map');
  initPlaceSearch(map);
  const heatmap = createPopulationHeatmap(map);

  const toolBanner = document.getElementById('tool-banner');
  const drawButton = document.getElementById('draw-polygon');
  const finishButton = document.getElementById('finish-polygon');
  const clearButton = document.getElementById('clear-polygon');

  const drawer = attachPolygonDrawer(map, {
    onComplete: (feature) => {
      finishButton.disabled = true;
      runEstimate(feature);
    },
    onClear: () => {
      finishButton.disabled = true;
      clearEstimate();
    },
    onCancel: () => {
      finishButton.disabled = true;
      setStatus('Drawing cancelled. Tap Draw area to start again.');
    },
    onVertexCount: (count) => {
      finishButton.disabled = count < 3 || !isToolZoomOk(map);
      if (count === 0) {
        setStatus('Tap the map to place the first corner.');
      } else if (count < 3) {
        setStatus(`Corner ${count} placed — need at least 3.`);
      } else {
        setStatus('Tap the first (orange) corner or Finish to close the area.');
      }
    },
  });

  // Test / debug hook used by Playwright smoke tests.
  window.__buildingPop = { map, drawer, heatmap, ready: false };
  map.on('load', () => {
    window.__buildingPop.ready = true;
    syncToolGate();
  });

  drawButton?.addEventListener('click', () => {
    if (!isToolZoomOk(map)) {
      syncToolGate();
      return;
    }
    drawer.startDrawing();
    setStatus('Tap the map to place corners. Tap the first corner to finish.');
  });

  finishButton?.addEventListener('click', () => {
    drawer.finish();
  });

  clearButton?.addEventListener('click', () => {
    drawer.clear();
  });

  function syncToolGate() {
    const enabled = isToolZoomOk(map);
    setToolEnabled(enabled);

    if (toolBanner) toolBanner.hidden = enabled;

    if (!enabled) {
      if (drawer.isDrawing()) drawer.cancelDrawing();
      setStatus(TOOL_DISABLED_NOTE);
    } else if (!drawer.getPolygon() && !latestCounts && !drawer.isDrawing()) {
      setStatus('Search for a city, then tap Draw area.');
    }
  }

  map.on('zoomend', syncToolGate);

  async function runEstimate(feature) {
    if (estimateInFlight) return;
    estimateInFlight = true;

    try {
      if (!isToolZoomOk(map)) {
        drawer.clear();
        syncToolGate();
        return;
      }

      if (!feature?.geometry) {
        clearEstimate();
        return;
      }

      if (activeController) activeController.abort();
      activeController = new AbortController();

      try {
        const areaKm2 = assertCityScaleArea(feature.geometry);
        latestAreaKm2 = areaKm2;
        setStatus('Querying OpenStreetMap buildings…', 'loading');

        const { counts, buildings } = await fetchBuildingsInPolygon(
          feature.geometry,
          {
            signal: activeController.signal,
            onStatus: (message) => setStatus(message, 'loading'),
          }
        );
        latestCounts = counts;
        latestBuildings = buildings;

        const params = readParams();
        const population = estimatePopulation(counts, params);
        heatmap.setBuildings(buildings, params);
        renderStats({ population, counts, areaKm2 });

        setStatus(
          counts.total
            ? `Counted ${counts.total} buildings in ${areaKm2.toFixed(2)} km².`
            : 'No buildings found in this polygon.'
        );
      } catch (error) {
        if (error.name === 'AbortError') return;

        latestCounts = null;
        latestBuildings = [];
        heatmap.clear();
        renderStats({
          population: null,
          counts: null,
          areaKm2: latestAreaKm2,
        });

        if (error.code === 'AREA_TOO_LARGE') {
          drawer.clear();
          setStatus(error.message, 'error');
          return;
        }

        console.error(error);
        setStatus(error.message || 'Building query failed.', 'error');
      }
    } finally {
      estimateInFlight = false;
    }
  }

  function clearEstimate() {
    if (activeController) activeController.abort();

    latestCounts = null;
    latestBuildings = [];
    latestAreaKm2 = null;
    heatmap.clear();
    renderStats({ population: null, counts: null, areaKm2: null });

    if (!isToolZoomOk(map)) {
      setStatus(TOOL_DISABLED_NOTE);
    } else {
      setStatus('Area cleared. Tap Draw area to estimate again.');
    }
  }

  function recomputeFromParams(params) {
    if (!latestCounts) return;

    const population = estimatePopulation(latestCounts, params);
    heatmap.updateWeights(params);
    renderStats({
      population,
      counts: latestCounts,
      areaKm2: latestAreaKm2,
    });
  }
}

main().catch((error) => {
  console.error(error);
  setStatus(error.message || 'App failed to start.', 'error');
});
