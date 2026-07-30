/*
 * Playwright regression: drawing a polygon must not blow the call stack,
 * and must produce an estimate request path.
 *
 * Run: npm run test:draw
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function main() {
  const server = await createServer({
    root,
    base: '/OpenStreetMapPopulation/',
    server: { host: '127.0.0.1', port: 5179, strictPort: true },
  });
  await server.listen();
  const serverUrl =
    server.resolvedUrls?.local?.[0] ??
    'http://127.0.0.1:5179/OpenStreetMapPopulation/';
  console.log('dev server:', serverUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.stack || error));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(serverUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__buildingPop?.ready === true, null, {
    timeout: 20000,
  });

  const apiResult = await page.evaluate(async () => {
    const { drawer } = window.__buildingPop;
    const errors = [];
    const onError = (event) => {
      errors.push(String(event.error?.stack || event.message || event));
    };
    window.addEventListener('error', onError);

    try {
      drawer.clear();
      drawer.startDrawing();

      // Drive the drawer the same way map clicks would, via public finish API:
      // place vertices by calling the private path through map click simulation
      // is covered below; here we finish a known-good polygon through evaluate.
      const map = window.__buildingPop.map;
      const points = [
        [-77.038, 38.895],
        [-77.035, 38.895],
        [-77.035, 38.893],
        [-77.038, 38.893],
      ];

      for (const [lng, lat] of points) {
        map.fire('click', { lngLat: { lng, lat }, point: map.project([lng, lat]) });
        await new Promise((r) => setTimeout(r, 20));
      }
      // Close on first vertex.
      map.fire('click', {
        lngLat: { lng: points[0][0], lat: points[0][1] },
        point: map.project(points[0]),
      });

      await new Promise((r) => setTimeout(r, 1500));

      const heatCount = window.__buildingPop.heatmap?.getFeatureCount?.() ?? 0;

      return {
        hasPolygon: !!drawer.getPolygon(),
        isDrawing: drawer.isDrawing(),
        status: document.getElementById('status')?.textContent ?? '',
        population: document.getElementById('stat-population')?.textContent ?? '',
        heatCount,
        errors,
      };
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  // UI button path
  await page.evaluate(() => window.__buildingPop.drawer.clear());
  await page.click('#draw-polygon');
  const box = await page.locator('#map').boundingBox();
  const uiPts = [
    [0.35, 0.30],
    [0.55, 0.30],
    [0.55, 0.48],
    [0.35, 0.48],
    [0.35, 0.30],
  ];
  for (const [px, py] of uiPts) {
    await page.mouse.click(box.x + box.width * px, box.y + box.height * py);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1000);

  const uiStatus = await page.locator('#status').textContent();
  const uiPopulation = await page.locator('#stat-population').textContent();

  // Draw area must grey out once a finished polygon exists.
  const drawDisabledAfterShape = await page.locator('#draw-polygon').isDisabled();
  const startBlocked = await page.evaluate(() => {
    const { drawer } = window.__buildingPop;
    const before = drawer.getPolygon()?.geometry?.coordinates?.[0]?.[0];
    const started = drawer.startDrawing();
    const after = drawer.getPolygon()?.geometry?.coordinates?.[0]?.[0];
    return { started, sameCorner: JSON.stringify(before) === JSON.stringify(after) };
  });

  // Dragging a corner updates the ring (via moveVertex API).
  const edited = await page.evaluate(() => {
    const { drawer } = window.__buildingPop;
    const ringBefore = drawer.getPolygon()?.geometry?.coordinates?.[0];
    const ok = drawer.moveVertex(1, [-77.034, 38.894]);
    const ringAfter = drawer.getPolygon()?.geometry?.coordinates?.[0];
    return {
      ok,
      changed:
        ringBefore &&
        ringAfter &&
        (ringBefore[1][0] !== ringAfter[1][0] || ringBefore[1][1] !== ringAfter[1][1]),
      vertexCount: drawer.getVertexCount(),
    };
  });

  // Clear button
  await page.click('#clear-polygon');
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => !window.__buildingPop.drawer.getPolygon());
  const drawEnabledAfterClear = await page.evaluate(() => {
    const btn = document.getElementById('draw-polygon');
    return btn && !btn.disabled;
  });

  await browser.close();
  await server.close();

  const allErrors = [...pageErrors, ...consoleErrors, ...(apiResult.errors || [])];
  const stackBlow = allErrors.filter((text) =>
    /Maximum call stack size exceeded|RangeError/i.test(text)
  );

  console.log(
    JSON.stringify(
      {
        apiResult,
        uiStatus,
        uiPopulation,
        drawDisabledAfterShape,
        startBlocked,
        edited,
        cleared,
        drawEnabledAfterClear,
        pageErrors,
        consoleErrors,
      },
      null,
      2
    )
  );

  if (stackBlow.length) {
    console.error('FAIL: stack overflow detected');
    console.error(stackBlow.join('\n\n'));
    process.exit(1);
  }

  if (!apiResult.hasPolygon) {
    console.error('FAIL: API click path did not create a polygon');
    process.exit(1);
  }

  if (!drawDisabledAfterShape || startBlocked.started !== false || !startBlocked.sameCorner) {
    console.error('FAIL: Draw area should stay disabled / not clear finished polygon');
    process.exit(1);
  }

  if (!edited.ok || !edited.changed) {
    console.error('FAIL: vertex edit did not update polygon');
    process.exit(1);
  }

  if (!cleared || !drawEnabledAfterClear) {
    console.error('FAIL: clear button did not remove polygon / re-enable Draw');
    process.exit(1);
  }

  // Heat features appear after Overpass returns; allow zero if Overpass failed.
  if (
    /Counted/i.test(apiResult.status) &&
    !(apiResult.heatCount > 0)
  ) {
    console.error('FAIL: expected heatmap points after a successful count');
    process.exit(1);
  }

  console.log('PASS: draw/edit/clear worked without stack overflow');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
