#!/usr/bin/env node
/**
 * Browser end-to-end check of the built app (dist/) in Chromium via Playwright.
 *   node scripts/build-preview.mjs && node scripts/e2e.mjs
 * Screenshots are written to e2e-screens/.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const shots = path.join(root, 'e2e-screens');
fs.mkdirSync(shots, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.fb2': 'application/xml', '.docx': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

try {
  await page.goto(base);
  await page.getByText('Open a design file').waitFor();
  await page.screenshot({ path: path.join(shots, '01-import.png') });
  check('Import screen renders', true);

  // ---- SVG poster sample (ZIP) ----
  await page.click('[data-sample="svg-poster.zip"]');
  await page.getByTestId('design-canvas').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=design-canvas] image').length >= 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, '02-canvas.png') });
  const status = await page.getByTestId('status-bar').innerText();
  check('Analysis ran in the Web Worker', status.includes('(worker)'), status.replace(/\n/g, ' · '));
  check('Status bar shows resolved count', /5\/7 images resolved/.test(status), status.match(/\d+\/\d+ images resolved/)?.[0]);
  const canvasImages = await page.$$eval('[data-testid=design-canvas] image', (els) => els.map((e) => e.getAttribute('href')?.slice(0, 5)));
  check('Canvas draws resolved images from blob URLs', canvasImages.every((h) => h === 'blob:'), canvasImages.join(','));
  const missingLabels = await page.$$eval('[data-testid=design-canvas] text', (els) => els.map((e) => e.textContent).filter((t) => /Missing|Remote/.test(t ?? '')));
  check('Missing and remote images are labelled, not replaced', missingLabels.length === 2, missingLabels.join(' | '));

  // Select a layer on the canvas
  await page.click('[data-testid=design-canvas] [data-node] >> nth=3', { force: true });
  const inspector = await page.getByLabel('Inspector').innerText();
  check('Clicking a canvas element opens its properties', /transform/i.test(inspector) && /alight motion/i.test(inspector), inspector.split('\n').slice(1, 3).join(' '));
  await page.screenshot({ path: path.join(shots, '03-canvas-selected.png') });

  // Zoom controls
  const zBefore = await page.locator('header').getByTitle('Reset to 100%').innerText();
  await page.getByLabel('Zoom in').click();
  const zAfter = await page.locator('header').getByTitle('Reset to 100%').innerText();
  check('Zoom in works', zBefore !== zAfter, `${zBefore} → ${zAfter}`);
  await page.getByLabel('Fit to screen').click();

  // ---- Assets ----
  await page.click('[data-view="assets"]');
  await page.locator('[data-asset]').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-asset] .xc-spin'));
  const cards = await page.$$eval('[data-asset]', (els) => els.map((e) => e.getAttribute('data-asset')));
  check('Gallery lists every detected image', cards.length === 7, cards.join(', '));
  await page.click('[data-asset="photo.jpg"]');
  const insp = await page.getByLabel('Inspector').innerText();
  check('Asset inspector shows dimensions and location', insp.includes('640 × 400 px') && insp.includes('assets/photo.jpg'));
  await page.screenshot({ path: path.join(shots, '04-assets.png') });
  await page.click('[data-asset="texture.png"]');
  const texInsp = await page.getByLabel('Inspector').innerText();
  check('Absolute-path match carries a visible warning', /absolute path/.test(texInsp));

  // Remote loading is opt-in; network is unavailable here, so it must fail with an explanation.
  const remoteBtn = page.getByRole('button', { name: /Load 1 remote image/ });
  check('Remote images are not loaded automatically', await remoteBtn.isVisible());
  await remoteBtn.click();
  await page.waitForFunction(() => !document.body.innerText.includes('Loading remote images'), null, { timeout: 20000 });
  await page.click('[data-asset="venue-map.png"]');
  const remoteInsp = await page.getByLabel('Inspector').innerText();
  check('Failed remote load explains why', /could not be loaded|responded with HTTP|not an image/.test(remoteInsp), remoteInsp.split('\n').find((l) => /loaded|HTTP/.test(l)));

  // ---- Source ----
  await page.click('[data-view="source"]');
  await page.getByTestId('source-view').waitFor();
  await page.getByLabel('Search source').fill('photo.jpg');
  await page.waitForTimeout(200);
  const matchText = await page.locator('text=/\\d+ of \\d+/').first().innerText();
  check('Source search finds matches', /1 of 1/.test(matchText), matchText);
  await page.getByRole('button', { name: /^Collapse lines/ }).nth(1).click();
  check('Folding collapses an element', await page.locator('text=/… \\d+ lines/').first().isVisible());
  await page.screenshot({ path: path.join(shots, '05-source.png') });

  // ---- Alight Motion ----
  await page.click('[data-view="alight"]');
  await page.getByText('Pre-export validation').waitFor();
  await page.getByText(/Passed/).first().waitFor({ timeout: 15000 });
  check('Validation passes for the poster', true);
  await page.screenshot({ path: path.join(shots, '06-alight.png'), fullPage: false });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-package').click()]);
  const zipPath = path.join(shots, 'package.zip');
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  const xmlName = names.find((n) => n.endsWith('.xml') && !n.startsWith('source/'));
  const xml = await zip.file(xmlName).async('string');
  const mediaFiles = names.filter((n) => /^[0-9a-f]{32}\.\w+$/.test(n));
  check('Package contains scene XML, media, report and source', !!xmlName && mediaFiles.length === 5 && names.includes('compatibility-report.md') && names.includes('source/poster.svg'), names.join(', '));
  check('Every fillImage in the package has its file', [...xml.matchAll(/fillImage="am-internal:\/\/\/([^"]+)"/g)].every((m) => names.includes(m[1])));
  await page.getByRole('button', { name: /Generated scene XML/ }).click();
  check('Generated XML preview is shown', (await page.getByTestId('am-xml').innerText()).includes('<scene title="poster"'));

  // Change a setting: background colour → XML updates
  await page.getByLabel('Transparent').uncheck();
  await page.waitForFunction(() => document.querySelector('[data-testid=am-xml]')?.textContent?.includes('bgcolor="#ff000000"'));
  check('Project settings update the XML', true);

  // ---- Theme ----
  await page.getByLabel('Switch to light theme').click();
  await page.click('[data-view="canvas"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '07-light-canvas.png') });
  check('Light theme applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.getByLabel('Switch to dark theme').click();

  // ---- Folder upload: Android project ----
  await page.getByTestId('folder-input').setInputFiles(path.join(root, 'samples', 'android-app'));
  await page.waitForFunction(() => document.body.innerText.includes('Android resource XML'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('[data-asset] .xc-spin'));
  const androidCards = await page.$$eval('[data-asset]', (els) => els.map((e) => e.getAttribute('data-asset')));
  const aStatus = await page.getByTestId('status-bar').innerText();
  check('Folder import resolves Android drawables', /2\/5 images resolved/.test(aStatus), androidCards.join(', '));
  await page.screenshot({ path: path.join(shots, '08-android.png') });
  await page.click('[data-view="alight"]');
  check('Alight Motion explains non-design formats', await page.getByText('Alight Motion conversion needs a design file').isVisible());

  // ---- DOCX via ZIP input ----
  await page.getByTestId('file-input').setInputFiles(path.join(root, 'samples', 'office', 'site-report.docx'));
  await page.waitForFunction(() => document.body.innerText.includes('Office Open XML'), null, { timeout: 15000 });
  const dStatus = await page.getByTestId('status-bar').innerText();
  check('DOCX package: images resolved through relationships', /2\/2 images resolved/.test(dStatus), dStatus.match(/\d+\/\d+ images resolved/)?.[0]);

  // ---- Broken XML ----
  await page.getByTestId('file-input').setInputFiles(path.join(root, 'samples', 'broken', 'unclosed-tag.xml'));
  await page.getByRole('alert').filter({ hasText: 'Line 8' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(shots, '09-parse-error.png') });
  check('Parse error is located and explained', (await page.getByRole('alert').filter({ hasText: 'Line 8' }).innerText()).includes('does not match'));

  // ---- Security sample ----
  await page.getByTestId('file-input').setInputFiles(path.join(root, 'samples', 'security', 'active-content.svg'));
  await page.getByTestId('design-canvas').waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  check('No script in the SVG executed', dialogs.length === 0, dialogs.join(' | '));

  // ---- Paste ----
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('menuitem', { name: 'Paste XML…' }).click();
  await page.getByRole('dialog').locator('textarea').fill('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#123456"/><image href="img/a.png" width="10" height="10"/></svg>');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByTestId('design-canvas').waitFor();
  await page.click('[data-view="assets"]');
  await page.locator('[data-asset="a.png"]').click();
  check('Pasted XML explains relative paths', (await page.getByLabel('Inspector').innerText()).includes('pasted as text'));

  const relevantErrors = consoleErrors.filter((e) => !/Failed to load resource|ERR_|net::/.test(e));
  check('No unexpected console errors', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('E2E run completed', false, e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(shots, 'zz-failure.png') });
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
