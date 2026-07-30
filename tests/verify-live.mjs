import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://jwitcoski.github.io/OpenStreetMapPopulation/';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__buildingPop?.ready === true, null, {
  timeout: 30000,
});

await page.locator('#draw-polygon').tap();
const box = await page.locator('#map').boundingBox();
for (const [px, py] of [
  [0.30, 0.22],
  [0.55, 0.22],
  [0.55, 0.40],
  [0.30, 0.40],
  [0.30, 0.22],
]) {
  await page.touchscreen.tap(box.x + box.width * px, box.y + box.height * py);
  await page.waitForTimeout(150);
}

await page.waitForFunction(() => {
  const status = document.getElementById('status')?.textContent || '';
  return /Counted|No buildings|failed|keep it under/i.test(status);
}, null, { timeout: 60000 });

const status = await page.locator('#status').textContent();
const population = await page.locator('#stat-population').textContent();
await page.locator('#clear-polygon').tap();
await page.waitForTimeout(200);
const cleared = await page.evaluate(() => !window.__buildingPop.drawer.getPolygon());

console.log(JSON.stringify({ URL, status, population, cleared, pageErrors }, null, 2));
const stack = pageErrors.filter((t) => /stack size|RangeError/i.test(t));
await browser.close();

if (stack.length || !cleared) {
  console.error('FAIL', stack);
  process.exit(1);
}
console.log('PASS live draw');
