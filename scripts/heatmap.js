/*
 * heatmap.js
 * Population heatmap from weighted building centers on the MapLibre map.
 */

import { peopleForBuilding } from './population.js';

const SOURCE_ID = 'population-heat';
const HEAT_LAYER = 'population-heat-layer';
const POINT_LAYER = 'population-heat-points';

/** Draw layers that should stay above the heatmap. */
const DRAW_LAYER_IDS = [
  'buildingpop-draw-fill',
  'buildingpop-draw-line',
  'buildingpop-draw-points',
];

/**
 * Create / update heatmap helpers bound to a map.
 * @param {import('maplibre-gl').Map} map
 */
export function createPopulationHeatmap(map) {
  let latestBuildings = [];

  const ensure = () => {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: emptyCollection(),
      });
    }

    if (!map.getLayer(HEAT_LAYER)) {
      map.addLayer(
        {
          id: HEAT_LAYER,
          type: 'heatmap',
          source: SOURCE_ID,
          maxzoom: 20,
          paint: {
            // weight 0–apartment-building contribution
            'heatmap-weight': [
              'interpolate',
              ['linear'],
              ['get', 'weight'],
              0,
              0,
              5,
              0.35,
              20,
              0.7,
              60,
              1,
            ],
            'heatmap-intensity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13,
              0.6,
              16,
              1.2,
              18,
              1.8,
            ],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(0,0,0,0)',
              0.15,
              '#d7ebe6',
              0.35,
              '#7ebfb2',
              0.55,
              '#0f6b5c',
              0.75,
              '#f0a202',
              1,
              '#9b2c2c',
            ],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13,
              18,
              15,
              28,
              17,
              40,
            ],
            'heatmap-opacity': 0.85,
          },
        },
        firstExistingDrawLayer(map)
      );
    }

    // Small dots help when zoomed in tightly (heatmap fades at high zoom).
    if (!map.getLayer(POINT_LAYER)) {
      map.addLayer(
        {
          id: POINT_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          minzoom: 16,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['get', 'weight'],
              0,
              2,
              40,
              7,
            ],
            'circle-color': [
              'interpolate',
              ['linear'],
              ['get', 'weight'],
              0,
              '#d7ebe6',
              10,
              '#0f6b5c',
              40,
              '#9b2c2c',
            ],
            'circle-opacity': 0.75,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        },
        firstExistingDrawLayer(map)
      );
    }
  };

  if (map.isStyleLoaded()) ensure();
  else map.once('load', ensure);

  /**
   * @param {import('./classify-buildings.js').BuildingRecord[]} buildings
   * @param {import('./population.js').EstimateParams} params
   */
  function setBuildings(buildings, params) {
    latestBuildings = buildings ?? [];
    ensure();
    const source = map.getSource(SOURCE_ID);
    if (!source) return;
    source.setData(buildingsToHeatFeatures(latestBuildings, params));
  }

  /** Re-weight existing buildings after form params change. */
  function updateWeights(params) {
    if (!latestBuildings.length) return;
    setBuildings(latestBuildings, params);
  }

  function clear() {
    latestBuildings = [];
    const source = map.getSource(SOURCE_ID);
    if (source) source.setData(emptyCollection());
  }

  return { setBuildings, updateWeights, clear };
}

/**
 * @param {import('./classify-buildings.js').BuildingRecord[]} buildings
 * @param {import('./population.js').EstimateParams} params
 */
export function buildingsToHeatFeatures(buildings, params) {
  return {
    type: 'FeatureCollection',
    features: buildings
      .map((building) => {
        const weight = peopleForBuilding(building.category, params);
        if (weight <= 0) return null;
        return {
          type: 'Feature',
          properties: {
            weight,
            category: building.category,
            buildingType: building.buildingType,
          },
          geometry: {
            type: 'Point',
            coordinates: [building.longitude, building.latitude],
          },
        };
      })
      .filter(Boolean),
  };
}

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function firstExistingDrawLayer(map) {
  return DRAW_LAYER_IDS.find((id) => map.getLayer(id));
}
