import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  createPngBuffer,
  writeTempFixture,
  parsePngDimensions,
  isJpegSignature,
  cleanupTempFixtures,
} from './test-helpers.js';

// These tests drive the real UI against the real Spring Boot backend on :8808.
// Start both first: `mvn spring-boot:run` in backend/, `npm run dev` in frontend/.

const upscaleButton = (page) => page.getByRole('button', { name: 'Upscale image' });
const radio = (page, name) => page.getByRole('radio', { name });
const pick = (page, name) => radio(page, name).check({ force: true });

async function addImage(page, name, w, h) {
  const fixture = writeTempFixture(name, createPngBuffer(w, h));
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('.file-id strong')).toHaveText(name);
}

async function upscale(page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/images/upscale') && r.status() === 200),
    upscaleButton(page).click(),
  ]);
  await expect(page.getByRole('button', { name: /^Download/ })).toBeVisible();
  return response.json();
}

async function saveDownload(page, label) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download/ }).click();
  const download = await pending;
  const target = writeTempFixture(label, Buffer.alloc(0));
  await download.saveAs(target);
  return { download, bytes: fs.readFileSync(target) };
}

test.describe('PixelPerfect end to end', () => {
  let consoleErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      const url = msg.location().url || '';
      if (msg.type() === 'error' && !/favicon|fonts\.g/.test(url)) consoleErrors.push(msg.text());
    });
    await page.goto('/');
  });

  test.afterAll(() => cleanupTempFixtures());

  test('1. empty state is ready to use and quiet', async ({ page }) => {
    await expect(page).toHaveTitle(/PixelPerfect/);
    await expect(page.getByText('Drop an image on the sheet')).toBeVisible();
    await expect(page.getByText('Server ready')).toBeVisible();
    await expect(radio(page, 'A4')).toBeChecked();
    await expect(radio(page, 'Portrait')).toBeChecked();
    await expect(radio(page, /^300/)).toBeChecked();
    await expect(upscaleButton(page)).toBeDisabled();
    expect(consoleErrors).toHaveLength(0);
  });

  test('2. adding an image shows its size, matches orientation and plans the output', async ({ page }) => {
    await addImage(page, 'sample_150x100.png', 150, 100);
    await expect(page.locator('.file-id span')).toContainText('150 × 100 px');
    await expect(radio(page, 'Landscape')).toBeChecked();
    await expect(page.locator('.facts')).toContainText('3508 × 2339 px');
    await expect(page.getByRole('img', { name: /Print quality/ })).toBeVisible();
  });

  test('3. upscales to the planned size through the backend', async ({ page }) => {
    await addImage(page, 'plan.png', 150, 100);
    const data = await upscale(page);
    expect(data.targetWidth).toBe(3508);
    expect(data.targetHeight).toBe(2339);
    expect(data.outputFormat).toBe('PNG');
    expect(data.dpi).toBe(300);
    await expect(page.getByText(/Upscaled to 3508 × 2339 px/)).toBeVisible();
    await expect(page.locator('.compare img').nth(1)).toHaveAttribute('src', /^data:image\/png;base64,/);
  });

  test('4. downloads a PNG with the right pixels and a descriptive name', async ({ page }) => {
    await addImage(page, 'holiday.png', 150, 100);
    await upscale(page);
    const { download, bytes } = await saveDownload(page, 'downloaded.png');
    expect(download.suggestedFilename()).toBe('holiday-A4-3508x2339-300dpi.png');
    expect(parsePngDimensions(bytes)).toEqual({ width: 3508, height: 2339 });
  });

  test('5. fill sheet crops in the browser and returns the exact sheet size', async ({ page }) => {
    await addImage(page, 'crop.png', 150, 100);
    await pick(page, /^Fill sheet/);
    const data = await upscale(page);
    expect(data.targetWidth).toBe(3508);
    expect(data.targetHeight).toBe(2480);
    const { bytes } = await saveDownload(page, 'cropped.png');
    expect(parsePngDimensions(bytes)).toEqual({ width: 3508, height: 2480 });
  });

  test('6. JPEG output shows the quality slider and downloads a real JPEG', async ({ page }) => {
    await addImage(page, 'jpeg_test.png', 100, 100);
    await page.getByRole('combobox', { name: 'Format' }).selectOption('JPEG');
    await expect(page.getByLabel(/Compression quality/)).toBeVisible();
    await upscale(page);
    const { download, bytes } = await saveDownload(page, 'downloaded.jpg');
    expect(download.suggestedFilename()).toMatch(/\.jpg$/);
    expect(isJpegSignature(bytes)).toBeTruthy();
  });

  test('7. scale mode multiplies the original', async ({ page }) => {
    await addImage(page, 'scale.png', 150, 100);
    await pick(page, 'Scale');
    await pick(page, /^4×/);
    const data = await upscale(page);
    expect(data.targetWidth).toBe(600);
    expect(data.targetHeight).toBe(400);
  });

  test('8. a sheet that is too big is blocked, with a one-click fix', async ({ page }) => {
    await addImage(page, 'big.png', 150, 100);
    await pick(page, 'A3');
    await pick(page, /^600/);
    await expect(page.getByRole('alert')).toContainText('over the 8192 px limit');
    await expect(upscaleButton(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Use 300 DPI' }).click();
    await expect(upscaleButton(page)).toBeEnabled();
  });

  test('9. unsupported files are refused with a clear message', async ({ page }) => {
    const bad = writeTempFixture('invalid.txt', Buffer.from('Not an image'));
    await page.locator('input[type="file"]').setInputFiles(bad);
    await expect(page.getByRole('alert')).toContainText("isn't a supported image");
  });

  test('10. the comparison slider works from the keyboard', async ({ page }) => {
    await addImage(page, 'slider.png', 80, 80);
    await upscale(page);
    const slider = page.getByRole('slider', { name: /Before and after/ });
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeLessThan(50);
  });

  test('11. changing a setting retires the old result, and replacing the image resets', async ({ page }) => {
    await addImage(page, 'first.png', 80, 80);
    await upscale(page);
    await pick(page, /^150/);
    await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
    await upscale(page);
    await page.locator('input[type="file"]').setInputFiles(writeTempFixture('second.png', createPngBuffer(100, 100)));
    await expect(page.locator('.file-id strong')).toHaveText('second.png');
    await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  });

  test('12. layout fits the screen on desktop and stacks without sideways scroll on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const stage = await page.locator('.stage').boundingBox();
    const inspector = await page.locator('.inspector').boundingBox();
    expect(inspector.x).toBeGreaterThanOrEqual(stage.x + stage.width - 2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(800);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await addImage(page, 'phone.png', 120, 160);
    const s = await page.locator('.stage').boundingBox();
    const i = await page.locator('.inspector').boundingBox();
    expect(i.y).toBeGreaterThanOrEqual(s.y + s.height - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
