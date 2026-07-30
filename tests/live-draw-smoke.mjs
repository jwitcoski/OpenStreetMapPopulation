/*
 * Hit the published GitHub Pages app and try to draw.
 * Captures pageerrors including Maximum call stack size exceeded.
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'https://jwitcoski.github.io/OpenStreetMapPopulation/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Inject a draw helper if the live build has no test hook: use MapboxDraw from the page if present.
  const outcome = await page.evaluate(async () => {
    const errors = [];
    const onError = (event) => errors.push(String(event.error?.stack || event.message || event));
    window.addEventListener('error', onError);

    try {
      // Find map canvas and click polygon control.
      const polygonBtn = document.querySelector('.mapbox-gl-draw_polygon');
      const trashBtn = document.querySelector('.mapbox-gl-draw_trash');
      const canvas = document.querySelector('.maplibregl-canvas');
      if (!polygonBtn || !canvas) {
        return {
          ok: false,
          reason: 'missing controls',
          polygonBtn: !!polygonBtn,
          canvas: !!canvas,
          errors,
        };
      }

      polygonBtn.click();
      await new Promise((r) => setTimeout(r, 200));

      const rect = canvas.getBoundingClientRect();
      const clicks = [
        [0.40, 0.40],
        [0.55, 0.40],
        [0.55, 0.55],
        [0.40, 0.55],
        [0.40, 0.40],
      ];

      for (const [px, py] of clicks) {
        const clientX = rect.left + rect.width * px;
        const clientY = rect.top + rect.height * py;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          canvas.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX,
              clientY,
              buttons: type.includes('up') ? 0 : 1,
            })
          );
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      await new Promise((r) => setTimeout(r, 1500));

      return {
        ok: true,
        status: document.getElementById('status')?.textContent ?? '',
        population: document.getElementById('stat-population')?.textContent ?? '',
        hasTrash: !!trashBtn,
        bodyClass: document.body.className,
        errors,
      };
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  await browser.close();

  const all = [...pageErrors, ...consoleErrors, ...(outcome.errors || [])];
  console.log(JSON.stringify({ url: URL, outcome, pageErrors, consoleErrors }, null, 2));

  const stack = all.filter((t) => /Maximum call stack size exceeded|RangeError/i.test(t));
  if (stack.length) {
    console.error('FAIL stack overflow on live site');
    console.error(stack.join('\n\n'));
    process.exit(1);
  }
  console.log('No stack overflow captured on live site from this harness');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
