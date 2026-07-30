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
import { fetchBuildingsInPolygon, OVERPASS_FAILED } from './overpass.js';
import { estimatePopulation } from './population.js';
import {
  compareRatio,
  fetchComparePopulation,
  getCompareDataset,
} from './compare-population.js';
import { createPopulationHeatmap } from './heatmap.js';
import {
  initPanel,
  loadPresets,
  readCompareDataset,
  renderCompareStats,
  renderStats,
  setStatus,
  hideRetry,
} from './panel.js';
import { initPlaceSearch } from './search.js';

/** Last successful building counts (used when form inputs change). */
let latestCounts = null;

/** Last building records for heatmap re-weighting. */
let latestBuildings = [];

/** Last measured polygon area in km². */
let latestAreaKm2 = null;

/** Last OSM population estimate (for comparison ratio). */
let latestPopulation = null;

/** Last successful reference comparison result. */
let latestCompare = null;

/** AbortController for the in-flight Overpass request. */
let activeController = null;

/** AbortController for the in-flight reference population request. */
let compareController = null;

/** Prevent overlapping estimate runs. */
let estimateInFlight = false;

/** Feature waiting to run after the current estimate finishes. */
let pendingEstimateFeature = null;

/** Debounce timer for reshaping a finished polygon. */
let editEstimateTimer = null;

const EDIT_REQUERY_MS = 700;

const TOOL_DISABLED_NOTE =
  `Zoom in to city level (z${TOOL_MIN_ZOOM}+) to draw. Overpass can only handle city-sized areas — not regions or countries.`;

async function main() {
  const { source, presets, defaultPresetId } = await loadPresets();
  const { readParams } = initPanel(
    { source, presets, defaultPresetId },
    {
      onParamsChange: recomputeFromParams,
      onCompareChange: () => {
        if (latestFeature?.geometry && latestPopulation != null) {
          runCompare(latestFeature.geometry, latestPopulation);
        } else {
          latestCompare = null;
          renderCompareStats({
            hidden: readCompareDataset() === 'none',
          });
        }
      },
    }
  );

  const { map } = createMap('map');
  initPlaceSearch(map);
  const heatmap = createPopulationHeatmap(map);

  const toolBanner = document.getElementById('tool-banner');
  const drawButton = document.getElementById('draw-polygon');
  const finishButton = document.getElementById('finish-polygon');
  const clearButton = document.getElementById('clear-polygon');
  const retryButton = document.getElementById('retry-overpass');

  /** Last polygon feature used for estimate / retry. */
  let latestFeature = null;

  const drawer = attachPolygonDrawer(map, {
    onComplete: (feature) => {
      latestFeature = feature;
      hideRetry();
      syncDrawChrome();
      runEstimate(feature);
    },
    onEdit: (feature) => {
      latestFeature = feature;
      hideRetry();
      syncDrawChrome();
      scheduleEditEstimate(feature);
    },
    onClear: () => {
      latestFeature = null;
      clearTimeout(editEstimateTimer);
      editEstimateTimer = null;
      hideRetry();
      syncDrawChrome();
      clearEstimate();
    },
    onCancel: () => {
      hideRetry();
      syncDrawChrome();
      setStatus('Drawing cancelled. Tap Draw area to start again.');
    },
    onVertexCount: (count) => {
      hideRetry();
      syncDrawChrome();
      if (count === 0) {
        setStatus('Tap the map to place the first corner.');
      } else if (count < 3) {
        setStatus(`Corner ${count} placed — need at least 3.`);
      } else {
        setStatus('Tap the first (orange) corner or Finish to close the area.');
      }
    },
    onStateChange: () => {
      syncDrawChrome();
    },
  });

  // Test / debug hook used by Playwright smoke tests.
  window.__buildingPop = { map, drawer, heatmap, ready: false };
  map.on('load', () => {
    window.__buildingPop.ready = true;
    syncToolGate();
  });

  drawButton?.addEventListener('click', () => {
    if (!isToolZoomOk(map) || drawer.getPolygon()) {
      syncDrawChrome();
      return;
    }
    if (!drawer.startDrawing()) return;
    hideRetry();
    setStatus('Tap the map to place corners. Tap the first corner to finish.');
    syncDrawChrome();
  });

  finishButton?.addEventListener('click', () => {
    drawer.finish();
  });

  clearButton?.addEventListener('click', () => {
    drawer.clear();
  });

  retryButton?.addEventListener('click', () => {
    const feature = latestFeature || drawer.getPolygon();
    if (!feature) {
      hideRetry();
      setStatus('No area to retry. Tap Draw area to start.');
      return;
    }
    hideRetry();
    runEstimate(feature);
  });

  function syncDrawChrome() {
    const zoomOk = isToolZoomOk(map);
    const hasPolygon = !!drawer.getPolygon();
    const drawing = drawer.isDrawing();
    const vertexCount = drawer.getVertexCount?.() ?? 0;

    setToolEnabled(zoomOk);

    // Draw area is one-shot until Clear — greys out once a shape exists.
    if (drawButton) {
      drawButton.disabled = !zoomOk || hasPolygon || drawing;
    }

    if (finishButton) {
      finishButton.disabled = !zoomOk || !drawing || vertexCount < 3;
    }
  }

  function syncToolGate() {
    const enabled = isToolZoomOk(map);

    if (toolBanner) toolBanner.hidden = enabled;

    if (!enabled) {
      if (drawer.isDrawing()) drawer.cancelDrawing();
      setStatus(TOOL_DISABLED_NOTE);
    } else if (!drawer.getPolygon() && !latestCounts && !drawer.isDrawing()) {
      setStatus('Search for a city, then tap Draw area.');
    } else if (drawer.getPolygon() && latestCounts) {
      setStatus(
        `Counted ${latestCounts.total} buildings. Drag corners to adjust, or Clear to start over.`
      );
    }

    syncDrawChrome();
  }

  function scheduleEditEstimate(feature) {
    clearTimeout(editEstimateTimer);
    hideRetry();
    setStatus('Boundary updated — requerying buildings…', 'loading');
    editEstimateTimer = setTimeout(() => {
      editEstimateTimer = null;
      runEstimate(feature);
    }, EDIT_REQUERY_MS);
  }

  map.on('zoomend', syncToolGate);

  async function runEstimate(feature) {
    if (estimateInFlight) {
      pendingEstimateFeature = feature;
      return;
    }
    estimateInFlight = true;
    pendingEstimateFeature = null;
    latestFeature = feature;
    hideRetry();

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
        const population = estimatePopulation(buildings, params);
        latestPopulation = population;
        heatmap.setBuildings(buildings, params);
        renderStats({
          population,
          counts,
          areaKm2,
          compare: {
            loading: readCompareDataset() !== 'none',
            hidden: readCompareDataset() === 'none',
            label: shortCompareLabel(readCompareDataset()),
          },
        });

        setStatus(
          counts.total
            ? `Counted ${counts.total} buildings in ${areaKm2.toFixed(2)} km². Drag corners to adjust.`
            : 'No buildings found in this polygon. Drag corners to adjust, or Clear.'
        );
        syncDrawChrome();
        runCompare(feature.geometry, population);
      } catch (error) {
        if (error.name === 'AbortError') return;

        latestCounts = null;
        latestBuildings = [];
        latestPopulation = null;
        latestCompare = null;
        abortCompare();
        heatmap.clear();
        renderStats({
          population: null,
          counts: null,
          areaKm2: latestAreaKm2,
          compare: { hidden: readCompareDataset() === 'none' },
        });

        if (error.code === 'AREA_TOO_LARGE') {
          drawer.clear();
          setStatus(error.message, 'error');
          return;
        }

        console.error(error);
        const isOverpassFailure =
          error.code === OVERPASS_FAILED ||
          error.name === 'OverpassError' ||
          /overpass|504|502|503|429|rate limit|too many requests|timeout|busy|network error/i.test(
            error.message || ''
          );

        const retryMessage = /429|rate limit|too many requests/i.test(
          error.message || ''
        )
          ? 'Overpass rate limit (429). Too many requests — do you want to try again?'
          : error.message ||
            'Overpass failed to run. Do you want to try again?';

        setStatus(
          isOverpassFailure
            ? retryMessage
            : error.message || 'Building query failed.',
          'error',
          { showRetry: isOverpassFailure && !!latestFeature }
        );
      }
    } finally {
      estimateInFlight = false;
      if (pendingEstimateFeature) {
        const next = pendingEstimateFeature;
        pendingEstimateFeature = null;
        runEstimate(next);
      }
    }
  }

  function clearEstimate() {
    if (activeController) activeController.abort();
    abortCompare();
    pendingEstimateFeature = null;
    clearTimeout(editEstimateTimer);
    editEstimateTimer = null;
    hideRetry();

    latestCounts = null;
    latestBuildings = [];
    latestAreaKm2 = null;
    latestPopulation = null;
    latestCompare = null;
    heatmap.clear();
    renderStats({
      population: null,
      counts: null,
      areaKm2: null,
      compare: { hidden: readCompareDataset() === 'none' },
    });

    if (!isToolZoomOk(map)) {
      setStatus(TOOL_DISABLED_NOTE);
    } else {
      setStatus('Area cleared. Tap Draw area to estimate again.');
    }
    syncDrawChrome();
  }

  function recomputeFromParams(params) {
    if (!latestCounts) return;

    const population = estimatePopulation(latestBuildings, params);
    latestPopulation = population;
    heatmap.updateWeights(params);
    renderStats({
      population,
      counts: latestCounts,
      areaKm2: latestAreaKm2,
      compare: compareStatsPayload(population),
    });
  }

  function abortCompare() {
    if (compareController) {
      compareController.abort();
      compareController = null;
    }
  }

  /**
   * Fetch WorldPop / GHS-POP for the polygon without blocking the OSM result.
   * @param {GeoJSON.Polygon} geometry
   * @param {number} population
   */
  async function runCompare(geometry, population) {
    abortCompare();
    const datasetId = readCompareDataset();

    if (datasetId === 'none' || !geometry) {
      latestCompare = null;
      renderCompareStats({ hidden: true });
      return;
    }

    compareController = new AbortController();
    const signal = compareController.signal;
    const label = shortCompareLabel(datasetId);

    renderCompareStats({ loading: true, label });

    try {
      const result = await fetchComparePopulation(geometry, datasetId, {
        signal,
      });
      if (signal.aborted) return;

      latestCompare = result;
      renderCompareStats({
        population: result?.population ?? null,
        ratio: compareRatio(population, result?.population),
        label: shortCompareLabel(datasetId, result?.dataset),
      });
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) return;
      console.error(error);
      latestCompare = null;
      renderCompareStats({
        error: error.message || 'Comparison failed',
        label,
      });
    } finally {
      if (compareController?.signal === signal) {
        compareController = null;
      }
    }
  }

  function compareStatsPayload(population) {
    const datasetId = readCompareDataset();
    if (datasetId === 'none') return { hidden: true };
    if (!latestCompare) {
      return {
        loading: false,
        population: null,
        ratio: null,
        label: shortCompareLabel(datasetId),
      };
    }
    return {
      population: latestCompare.population,
      ratio: compareRatio(population, latestCompare.population),
      label: shortCompareLabel(datasetId, latestCompare.dataset),
    };
  }
}

/**
 * @param {import('./compare-population.js').CompareDatasetId} datasetId
 * @param {{ label?: string } | null} [dataset]
 */
function shortCompareLabel(datasetId, dataset = null) {
  if (datasetId === 'worldpop') return dataset?.year === 2025 ? 'WorldPop 2025' : 'WorldPop';
  if (datasetId === 'ghs-pop') return 'GHS-POP';
  return getCompareDataset(datasetId).label;
}

main().catch((error) => {
  console.error(error);
  setStatus(error.message || 'App failed to start.', 'error');
});
