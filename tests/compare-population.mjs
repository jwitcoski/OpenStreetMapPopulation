/*
 * Unit tests for WorldPop / GHS-POP comparison helpers (no network).
 */
import assert from 'node:assert/strict';
import {
  compareRatio,
  pointInPolygon,
  polygonBbox,
  sumGeoTiffInPolygon,
  getCompareDataset,
} from '../scripts/compare-population.js';

// --- compareRatio ---
assert.equal(compareRatio(100, 200), 0.5);
assert.equal(compareRatio(null, 200), null);
assert.equal(compareRatio(100, 0), null);
assert.equal(compareRatio(100, null), null);

// --- pointInPolygon ---
const square = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
  [0, 0],
];
assert.equal(pointInPolygon([1, 1], square), true);
assert.equal(pointInPolygon([3, 1], square), false);
assert.equal(pointInPolygon([-0.1, 1], square), false);

// --- polygonBbox ---
assert.deepEqual(
  polygonBbox({
    type: 'Polygon',
    coordinates: [
      [
        [-77.05, 38.89],
        [-77.03, 38.89],
        [-77.03, 38.91],
        [-77.05, 38.91],
        [-77.05, 38.89],
      ],
    ],
  }),
  [-77.05, 38.89, -77.03, 38.91]
);

assert.equal(getCompareDataset('ghs-pop').year, 2025);
assert.equal(getCompareDataset('worldpop').id, 'worldpop');
assert.equal(getCompareDataset('none').id, 'none');

// --- sumGeoTiffInPolygon with a tiny synthetic float64 GeoTIFF ---
function buildFloat64GeoTiff({ width, height, minX, minY, maxX, maxY, values }) {
  // Minimal big-endian tiled GeoTIFF is hard; use geotiff-friendly strip TIFF.
  // Build via a known-good pattern: write IFD with StripOffsets.
  const sampleFormat = 3; // IEEE float
  const bitsPerSample = 64;
  const pixelBytes = 8;
  const stripBytes = width * height * pixelBytes;
  const stripData = Buffer.alloc(stripBytes);
  for (let i = 0; i < values.length; i += 1) {
    stripData.writeDoubleBE(values[i], i * 8);
  }

  // We'll use geotiff's own round-trip by creating ArrayBuffer from a real WCS
  // is overkill for unit test — instead mock band path by testing pointInPolygon
  // coverage math separately. For sumGeoTiffInPolygon, build with geotiff write
  // isn't available. Skip full TIFF encode: call sum with a fixture from disk
  // only if we craft one.

  // Craft minimal Classic TIFF BE:
  // Header + IFD with required tags + strip
  const entries = [];
  const push = (tag, type, count, valueOrOffset) => {
    entries.push({ tag, type, count, valueOrOffset });
  };
  // SHORT=3 LONG=4 DOUBLE=12 RATIONAL=5
  push(256, 3, 1, width); // ImageWidth
  push(257, 3, 1, height); // ImageLength
  push(258, 3, 1, bitsPerSample); // BitsPerSample
  push(259, 3, 1, 1); // Compression none
  push(262, 3, 1, 1); // Photometric min-is-black
  push(273, 4, 1, 0); // StripOffsets — filled later
  push(277, 3, 1, 1); // SamplesPerPixel
  push(278, 4, 1, height); // RowsPerStrip
  push(279, 4, 1, stripBytes); // StripByteCounts
  push(339, 3, 1, sampleFormat); // SampleFormat float

  // ModelTiepoint + PixelScale as GeoTIFF tags for bbox
  // 33550 ModelPixelScaleTag DOUBLE 3
  // 33922 ModelTiepointTag DOUBLE 6
  const scale = [(maxX - minX) / width, (maxY - minY) / height, 0];
  const tie = [0, 0, 0, minX, maxY, 0]; // pixel 0,0 -> top-left

  const numEntries = entries.length + 2;
  const headerSize = 8;
  const ifdSize = 2 + numEntries * 12 + 4;
  const doublesOffset = headerSize + ifdSize;
  const scaleOffset = doublesOffset;
  const tieOffset = scaleOffset + 3 * 8;
  const stripOffset = tieOffset + 6 * 8;

  push(33550, 12, 3, scaleOffset);
  push(33922, 12, 6, tieOffset);
  entries.sort((a, b) => a.tag - b.tag);
  // fix StripOffsets value
  const stripEntry = entries.find((e) => e.tag === 273);
  stripEntry.valueOrOffset = stripOffset;

  const buf = Buffer.alloc(stripOffset + stripBytes);
  buf.write('MM', 0); // big endian
  buf.writeUInt16BE(42, 2);
  buf.writeUInt32BE(8, 4); // IFD at 8
  buf.writeUInt16BE(numEntries, 8);
  let p = 10;
  for (const e of entries) {
    buf.writeUInt16BE(e.tag, p);
    buf.writeUInt16BE(e.type, p + 2);
    buf.writeUInt32BE(e.count, p + 4);
    if (e.type === 3 && e.count === 1) {
      buf.writeUInt16BE(e.valueOrOffset, p + 8);
      buf.writeUInt16BE(0, p + 10);
    } else {
      buf.writeUInt32BE(e.valueOrOffset, p + 8);
    }
    p += 12;
  }
  buf.writeUInt32BE(0, p); // next IFD
  // scales
  for (let i = 0; i < 3; i += 1) buf.writeDoubleBE(scale[i], scaleOffset + i * 8);
  for (let i = 0; i < 6; i += 1) buf.writeDoubleBE(tie[i], tieOffset + i * 8);
  stripData.copy(buf, stripOffset);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const tiffBuffer = buildFloat64GeoTiff({
  width: 2,
  height: 2,
  minX: 0,
  minY: 0,
  maxX: 2,
  maxY: 2,
  values: [10, 20, 30, 40],
});

const polyCoverAll = {
  type: 'Polygon',
  coordinates: [
    [
      [-0.1, -0.1],
      [2.1, -0.1],
      [2.1, 2.1],
      [-0.1, 2.1],
      [-0.1, -0.1],
    ],
  ],
};

const sumAll = await sumGeoTiffInPolygon(tiffBuffer, polyCoverAll);
assert.equal(sumAll, 100);

const polyHalf = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};
const sumHalf = await sumGeoTiffInPolygon(tiffBuffer, polyHalf);
// Centers at (0.5,1.5)=30 and (0.5,0.5)=10 → row0 col0=10, row1 col0=30
assert.equal(sumHalf, 40);

console.log('compare-population unit tests passed');
