/*
 * main.js
 * App entry point — wires map drawing to Overpass + population estimate.
 *
 * File map:
 *   styles/*                  CSS (variables, layout, panel, search)
 *   scripts/config.js         Zoom limits and building-type lists
 *   scripts/map.js            MapLibre map + draw tools
 *   scripts/search.js         City / area search
 *   scripts/overpass.js       Fetch buildings from Overpass
 *   scripts/classify-buildings.js  Count houses / apartments / etc.
 *   scripts/population.js     Estimate residents from counts
 *   scripts/panel.js          Side-panel DOM updates
 */

import '../styles/variables.css';
import '../styles/layout.css';
import '../styles/panel.css';
import '../styles/search.css';

import { TOOL_MIN_ZOOM } from './config.js';
import {
  assertCityScaleArea,
  createMap,
  getDrawnPolygon,
  isToolZoomOk,
  setDrawToolEnabled,
} from './map.js';
import { fetchBuildingsInPolygon } from './overpass.js';
import { estimatePopulation } from './population.js';
import {
  initPanel,
  loadPresets,
  renderStats,
  setStatus,
} from './panel.js';
import { initPlaceSearch } from './search.js';

/** Last successful building counts (used when form inputs change). */
let latestCounts = null;

/** Last measured polygon area in km². */
let latestAreaKm2 = null;

/** AbortController for the in-flight Overpass request. */
let activeController = null;

const TOOL_DISABLED_NOTE =
  `Zoom in to city level (z${TOOL_MIN_ZOOM}+) to draw. Overpass can only handle city-sized areas — not regions or countries.`;

async function main() {
  const presets = await loadPresets();
  const { readParams } = initPanel(presets, {
    onParamsChange: recomputeFromParams,
  });

  const { map, draw } = createMap('map');
  initPlaceSearch(map);

  const toolBanner = document.getElementById('tool-banner');
  const clearButton = document.getElementById('clear-polygon');

  clearButton?.addEventListener('click', () => {
    if (draw.getAll().features.length === 0) {
      clearEstimate();
      return;
    }
    draw.deleteAll();
  });

  function syncToolGate() {
    const enabled = isToolZoomOk(map);
    setDrawToolEnabled(draw, enabled);

    if (toolBanner) {
      toolBanner.hidden = enabled;
    }

    if (!enabled) {
      setStatus(TOOL_DISABLED_NOTE);
    } else if (!getDrawnPolygon(draw) && !latestCounts) {
      setStatus('Draw a polygon over the area you want to estimate.');
    }
  }

  map.on('load', () => {
    syncToolGate();
  });

  map.on('zoomend', syncToolGate);
  map.on('zoom', syncToolGate);

  map.on('draw.create', runEstimate);
  map.on('draw.update', runEstimate);
  map.on('draw.delete', clearEstimate);

  /**
   * When the user draws or edits a polygon:
   * 1. Check zoom + area are city-scale
   * 2. Query Overpass for buildings
   * 3. Classify + estimate population
   * 4. Update the side panel
   */
  async function runEstimate() {
    if (!isToolZoomOk(map)) {
      draw.deleteAll();
      syncToolGate();
      return;
    }

    const feature = getDrawnPolygon(draw);

    if (!feature) {
      clearEstimate();
      return;
    }

    // Cancel any previous query still running.
    if (activeController) activeController.abort();
    activeController = new AbortController();

    try {
      const areaKm2 = assertCityScaleArea(feature.geometry);
      latestAreaKm2 = areaKm2;
      setStatus('Querying OpenStreetMap buildings…', 'loading');

      const counts = await fetchBuildingsInPolygon(feature.geometry, {
        signal: activeController.signal,
      });
      latestCounts = counts;

      const population = estimatePopulation(counts, readParams());
      renderStats({ population, counts, areaKm2 });

      setStatus(
        counts.total
          ? `Counted ${counts.total} buildings in ${areaKm2.toFixed(2)} km².`
          : 'No buildings found in this polygon.'
      );
    } catch (error) {
      if (error.name === 'AbortError') return;

      latestCounts = null;
      renderStats({
        population: null,
        counts: null,
        areaKm2: latestAreaKm2,
      });

      if (error.code === 'AREA_TOO_LARGE') {
        draw.deleteAll();
        setStatus(error.message, 'error');
        return;
      }

      console.error(error);
      setStatus(error.message || 'Building query failed.', 'error');
    }
  }

  function clearEstimate() {
    if (activeController) activeController.abort();

    latestCounts = null;
    latestAreaKm2 = null;
    renderStats({ population: null, counts: null, areaKm2: null });

    if (!isToolZoomOk(map)) {
      setStatus(TOOL_DISABLED_NOTE);
    } else {
      setStatus('Polygon cleared. Draw another to estimate.');
    }
  }

  /** Re-run the math when the user tweaks form numbers (no new Overpass call). */
  function recomputeFromParams(params) {
    if (!latestCounts) return;

    const population = estimatePopulation(latestCounts, params);
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
