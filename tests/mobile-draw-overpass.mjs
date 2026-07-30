/*
 * Mobile tap path against production preview.
 */

import { chromium } from 'playwright';
import { preview } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function main() {
  const server = await preview({
    root,
    base: '/OpenStreetMapPopulation/',
    preview: { host: '127.0.0.1', port: 4181, strictPort: true },
  });

  const url =
    server.resolvedUrls?.local?.[0] ??
    'http://127.0.0.1:4181/OpenStreetMapPopulation/';
  console.log('preview:', url);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)));

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForFunction(() => window.__buildingPop?.ready === true);

  await page.locator('#draw-polygon').tap();
  const box = await page.locator('#map').boundingBox();
  const pts = [
    [0.30, 0.22],
    [0.55, 0.22],
    [0.55, 0.40],
    [0.30, 0.40],
    [0.30, 0.22],
  ];
  for (const [px, py] of pts) {
    await page.touchscreen.tap(box.x + box.width * px, box.y + box.height * py);
    await page.waitForTimeout(150);
  }

  // Wait for estimate attempt to finish (success or Overpass/network error).
  await page.waitForFunction(() => {
    const status = document.getElementById('status')?.textContent || '';
    return /Counted|No buildings|failed|keep it under|remark/i.test(status);
  }, null, { timeout: 60000 });

  const status = await page.locator('#status').textContent();
  const population = await page.locator('#stat-population').textContent();
  const heatCount = await page.evaluate(() => {
    return window.__buildingPop?.heatmap?.getFeatureCount?.() ?? 0;
  });

  await page.locator('#clear-polygon').tap();
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => !window.__buildingPop.drawer.getPolygon());
  const heatCleared = await page.evaluate(() => {
    return (window.__buildingPop?.heatmap?.getFeatureCount?.() ?? 0) === 0;
  });

  console.log(JSON.stringify({ status, population, heatCount, cleared, heatCleared, pageErrors }, null, 2));

  const stack = pageErrors.filter((t) => /stack size|RangeError/i.test(t));
  await browser.close();
  await server.httpServer.close();

  if (stack.length) {
    console.error('FAIL stack overflow');
    console.error(stack.join('\n'));
    process.exit(1);
  }
  if (!cleared || !heatCleared) {
    console.error('FAIL clear');
    process.exit(1);
  }
  // Overpass public servers can 504; draw/clear without stack overflow is the gate.
  if (!/Counted|No buildings|failed|keep it under/i.test(status || '')) {
    console.error('FAIL unexpected status:', status);
    process.exit(1);
  }
  if (/Counted/i.test(status || '') && !(heatCount > 0)) {
    console.error('FAIL expected heatmap points after count');
    process.exit(1);
  }
  console.log('PASS mobile draw + heatmap + clear (no stack overflow)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
