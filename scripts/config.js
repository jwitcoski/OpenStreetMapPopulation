/*
 * config.js
 * Tunable app settings and OSM building-type groups.
 * Change zoom / area limits here — nowhere else.
 */

/**
 * How far out the map can zoom for browsing (world / country ok).
 * Drawing / Overpass queries still require TOOL_MIN_ZOOM.
 */
export const MIN_ZOOM = 2;

/** Highest zoom the map allows. */
export const MAX_ZOOM = 19;

/**
 * Minimum zoom before the draw / estimate tool is enabled.
 * Below this, users can pan the map but cannot query Overpass.
 */
export const TOOL_MIN_ZOOM = 13;

/** Starting view: [longitude, latitude]. */
export const DEFAULT_CENTER = [-77.03659, 38.89399]; // Washington, DC

/** Starting zoom level. */
export const DEFAULT_ZOOM = 15;

/** Zoom used after picking a city from search. */
export const SEARCH_ZOOM = 15;

/**
 * Largest polygon area we will send to Overpass (square kilometers).
 * Keeps queries at city-block / neighborhood scale.
 */
export const MAX_AREA_KM2 = 12;

/** Public Overpass mirrors (independent operators — tried slowly on failure). */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/** @deprecated use OVERPASS_URLS — kept for older imports */
export const OVERPASS_URL = OVERPASS_URLS[0];

/** Photon geocoder (OpenStreetMap data, no API key). */
export const PHOTON_URL = 'https://photon.komoot.io/api/';

/** OSM building=* values counted as single-family / house-like. */
export const HOUSE_TYPES = new Set([
  'house',
  'detached',
  'semidetached_house',
  'terrace',
  'bungalow',
  'cabin',
  'farm',
  'static_caravan',
  'ger',
  'houseboat',
]);

/** OSM building=* values counted as multi-unit / apartment-like. */
export const APARTMENT_TYPES = new Set([
  'apartments',
  'residential',
  'dormitory',
  'hotel',
]);

/** OSM building=* values treated as non-residential (excluded from pop). */
export const COMMERCIAL_TYPES = new Set([
  'commercial',
  'industrial',
  'retail',
  'warehouse',
  'office',
  'garage',
  'garages',
  'hangar',
  'factory',
  'manufacture',
  'supermarket',
  'kiosk',
  'shed',
  'barn',
  'farm_auxiliary',
  'service',
  'school',
  'hospital',
  'church',
  'chapel',
  'mosque',
  'temple',
  'cathedral',
  'public',
  'civic',
  'government',
  'university',
  'college',
  'kindergarten',
  'train_station',
  'transportation',
  'parking',
]);
