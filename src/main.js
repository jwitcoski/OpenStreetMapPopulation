import './style.css';
import { createMap, getDrawnPolygon, assertCityScaleArea } from './map.js';
import { fetchBuildingsInPolygon } from './overpass.js';
import { estimatePopulation } from './population.js';
import { initPanel, loadPresets, renderStats, setStatus } from './ui.js';
import { MIN_ZOOM } from './config.js';

let latestCounts = null;
let latestAreaKm2 = null;
let activeController = null;

async function main() {
  const presets = await loadPresets();
  const { readParams } = initPanel(presets, {
    onParamsChange: recomputeFromParams,
  });

  const { map, draw } = createMap('map');

  map.on('load', () => {
    setStatus(`Zoom in to city level (z${MIN_ZOOM}+), then draw a polygon.`);
  });

  const runEstimate = async () => {
    const feature = getDrawnPolygon(draw);
    if (!feature) {
      latestCounts = null;
      latestAreaKm2 = null;
      renderStats({ population: null, counts: null, areaKm2: null });
      setStatus('Draw a polygon over the area you want to estimate.');
      return;
    }

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
  };

  map.on('draw.create', runEstimate);
  map.on('draw.update', runEstimate);
  map.on('draw.delete', () => {
    if (activeController) activeController.abort();
    latestCounts = null;
    latestAreaKm2 = null;
    renderStats({ population: null, counts: null, areaKm2: null });
    setStatus('Polygon cleared. Draw another to estimate.');
  });

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
