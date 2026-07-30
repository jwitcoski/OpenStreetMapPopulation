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
    if (msg.type() === 'error') pageErrors.push('console:' + msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  const outcome = await page.evaluate(async () => {
    const errors = [];
    window.addEventListener('error', (e) => errors.push(String(e.error?.stack || e.message)));
    window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.stack || e.reason)));

    const polygonBtn = document.querySelector('.mapbox-gl-draw_polygon');
    const canvas = document.querySelector('.maplibregl-canvas');
    polygonBtn.click();
    await new Promise((r) => setTimeout(r, 300));

    const rect = canvas.getBoundingClientRect();
    const pts = [[0.35,0.35],[0.6,0.35],[0.6,0.6],[0.35,0.6],[0.35,0.35]];

    function fireTouch(type, x, y) {
      const target = document.elementFromPoint(x, y) || canvas;
      const touch = new Touch({
        identifier: 1,
        target,
        clientX: x,
        clientY: y,
        radiusX: 2.5,
        radiusY: 2.5,
        rotationAngle: 0,
        force: 1,
      });
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      }));
    }

    for (const [px, py] of pts) {
      const x = rect.left + rect.width * px;
      const y = rect.top + rect.height * py;
      fireTouch('touchstart', x, y);
      await new Promise((r) => setTimeout(r, 30));
      fireTouch('touchend', x, y);
      // mobile browsers also synthesize click
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      await new Promise((r) => setTimeout(r, 150));
    }

    await new Promise((r) => setTimeout(r, 2000));
    return {
      status: document.getElementById('status')?.textContent,
      population: document.getElementById('stat-population')?.textContent,
      errors,
    };
  });

  console.log(JSON.stringify({ URL, outcome, pageErrors }, null, 2));
  const stack = [...pageErrors, ...(outcome.errors||[])].filter(t => /stack size|RangeError/i.test(t));
  if (stack.length) {
    console.error('REPRODUCED:\n' + stack.join('\n'));
    process.exit(1);
  }
  await browser.close();
  console.log('no stack overflow');
}
main().catch(e => { console.error(e); process.exit(1); });
