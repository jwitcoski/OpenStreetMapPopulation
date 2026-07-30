/*
 * Real Playwright tap/click drawing against local preview.
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:4180/OpenStreetMapPopulation/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)));
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      pageErrors.push(`${msg.type()}: ${msg.text()}`);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 });
  await page.waitForTimeout(2000);

  await page.locator('.mapbox-gl-draw_polygon').tap();
  await page.waitForTimeout(300);

  const box = await page.locator('.maplibregl-canvas').boundingBox();
  const pts = [
    [0.35, 0.30],
    [0.65, 0.30],
    [0.65, 0.55],
    [0.35, 0.55],
    [0.35, 0.30],
  ];

  for (const [px, py] of pts) {
    const x = box.x + box.width * px;
    const y = box.y + box.height * py;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(3000);

  const status = await page.locator('#status').textContent();
  const population = await page.locator('#stat-population').textContent();

  console.log(JSON.stringify({ URL, status, population, pageErrors }, null, 2));

  const stack = pageErrors.filter((t) => /stack size|RangeError/i.test(t));
  await browser.close();

  if (stack.length) {
    console.error('REPRODUCED');
    console.error(stack.join('\n\n'));
    process.exit(1);
  }
  console.log('no stack overflow with real taps');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
