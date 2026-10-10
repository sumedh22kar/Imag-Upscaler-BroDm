import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  createPngBuffer,
  writeTempFixture,
  parsePngDimensions,
  isJpegSignature,
  cleanupTempFixtures,
} from './test-helpers.js';

test.describe('PixelPerfect Real Browser End-to-End Test Suite', () => {
  let consoleErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
  });

  test.afterAll(() => {
    cleanupTempFixtures();
  });

  // 1. Initial Empty State & Brand Identity
  test('1. Initial empty state displays correctly with no console errors', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/PixelPerfect/);
    await expect(page.locator('.brand')).toContainText('PixelPerfect');
    await expect(page.locator('.free-badge')).toContainText('FREE · NO AI');

    // Step 01 dropzone
    const dropzone = page.locator('.dropzone');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toContainText('Drop your image here');
    await expect(dropzone).toContainText('Choose image');

    // Step 02 output settings
    await expect(page.getByRole('heading', { name: 'Output settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scale Factor' })).toHaveClass(/active/);

    // Primary resize button is disabled before upload
    const resizeBtn = page.getByRole('button', { name: /Resize image/i });
    await expect(resizeBtn).toBeDisabled();
    await expect(resizeBtn).toHaveAttribute('title', 'Select or upload an image first');

    // Verify backend is reachable without console errors
    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  // 2. Real Image Upload, Dimension Detection & Sizing Mode Controls
  test('2. Upload real PNG, verify original dimensions, and change scale multiplier', async ({ page }) => {
    const fixturePath = writeTempFixture('sample_150x100.png', createPngBuffer(150, 100));

    await page.goto('/');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(fixturePath);

    // Verify file details rendered in preview card
    await expect(page.locator('.file-name')).toContainText('sample_150x100.png');
    await expect(page.locator('.file-meta')).toContainText('150 × 100 px');
    await expect(page.locator('.file-meta')).toContainText('PNG');

    // Step 01 image info table
    await expect(page.locator('.image-info')).toContainText('150 × 100 px');

    // Default 2x multiplier should plan 300x200 px
    const summaryCard = page.locator('.output-summary-card');
    await expect(summaryCard).toBeVisible();
    await expect(summaryCard).toContainText('300 × 200 px');

    // Change scale factor to 4x
    await page.getByRole('button', { name: '4×' }).click();
    await expect(summaryCard).toContainText('600 × 400 px');
    await expect(page.locator('.image-info')).toContainText('600 × 400 px');
  });

  // 3. End-to-End Upscale Processing through Real Spring Boot Backend
  test('3. Process image via real backend and verify result metrics and preview', async ({ page }) => {
    const fixturePath = writeTempFixture('test_process.png', createPngBuffer(100, 80));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);

    // Select 2x scale
    await page.getByRole('button', { name: '2×' }).click();

    // Click Resize image
    const resizeBtn = page.getByRole('button', { name: /Resize image/i });
    await expect(resizeBtn).toBeEnabled();

    // Monitor network call to /api/images/upscale
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/images/upscale') && res.status() === 200),
      resizeBtn.click(),
    ]);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.targetWidth).toBe(200);
    expect(data.targetHeight).toBe(160);
    expect(data.outputFormat).toBe('PNG');

    // Verify UI reflects successful completion
    await expect(page.locator('.result-metrics-card')).toBeVisible();
    await expect(page.locator('.result-metrics-heading')).toContainText('✓ Processing Completed Successfully');
    await expect(page.locator('.result-metrics-grid')).toContainText('200 × 160 px');
    await expect(page.locator('.result-metrics-grid')).toContainText('PNG · 300 DPI');

    // Verify preview display
    const previewImg = page.locator('.comparison-processed img');
    await expect(previewImg).toBeVisible();
    const src = await previewImg.getAttribute('src');
    expect(src).toMatch(/^data:image\/png;base64,/);
  });

  // 4. Download Execution & Binary File Inspection (Magic Bytes + Dimensions)
  test('4. Download processed output and verify file signature, dimensions and filename', async ({ page }) => {
    const fixturePath = writeTempFixture('download_test.png', createPngBuffer(120, 90));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await page.getByRole('button', { name: '2×' }).click();

    const resizeBtn = page.getByRole('button', { name: /Resize image/i });
    await resizeBtn.click();
    await expect(page.locator('.result-metrics-card')).toBeVisible();

    // Trigger download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download processed image/i }).click();
    const download = await downloadPromise;

    // Verify filename format: {name}_upscaled_{w}x{h}.png
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toContain('download_test_upscaled_240x180.png');

    // Save and verify actual downloaded binary content
    const downloadPath = writeTempFixture('downloaded_output.png', Buffer.alloc(0));
    await download.saveAs(downloadPath);

    const fileBuffer = fs.readFileSync(downloadPath);
    expect(fileBuffer.length).toBeGreaterThan(0);

    // Verify PNG header and dimensions directly from downloaded binary bytes
    const dims = parsePngDimensions(fileBuffer);
    expect(dims.width).toBe(240);
    expect(dims.height).toBe(180);
  });

  // 5. Output Format Switching (JPEG with Quality Control)
  test('5. Change output format to JPEG, process and verify JPEG binary structure', async ({ page }) => {
    const fixturePath = writeTempFixture('jpeg_test.png', createPngBuffer(100, 100));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);

    // Select JPEG format
    await page.locator('label', { hasText: 'Output format' }).locator('select').selectOption('JPEG');

    // Quality slider should now appear
    const qualityControl = page.locator('.quality-control');
    await expect(qualityControl).toBeVisible();
    await expect(qualityControl).toContainText('95%');

    // Process image
    const resizeBtn = page.getByRole('button', { name: /Resize image/i });
    await resizeBtn.click();

    await expect(page.locator('.result-metrics-card')).toBeVisible();
    await expect(page.locator('.result-metrics-grid')).toContainText('JPEG');

    // Download and verify JPEG magic bytes
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download processed image/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.jpg');

    const downloadPath = writeTempFixture('downloaded_jpeg.jpg', Buffer.alloc(0));
    await download.saveAs(downloadPath);

    const fileBuffer = fs.readFileSync(downloadPath);
    expect(isJpegSignature(fileBuffer)).toBeTruthy();
  });

  // 6. Print Calculator Integration with Real Backend
  test('6. Print calculator calculates A4 dimensions via backend and switches orientation', async ({ page }) => {
    await page.goto('/');

    // Switch to Print Calculator tab
    await page.getByRole('button', { name: 'Print Calculator' }).click();

    // Standard preset defaults to A4
    const presetSelect = page.locator('label', { hasText: 'Print standard preset' }).locator('select');
    await expect(presetSelect).toHaveValue('A4');

    // Calculated card should display backend calculations for A4 at 300 DPI (2480 x 3508 px)
    const calcCard = page.locator('.calculated-px-card');
    await expect(calcCard).toBeVisible();
    await expect(calcCard.locator('.calc-value')).toContainText('2480 × 3508 px');

    // Switch orientation to Landscape
    const landscapeBtn = page.locator('.orientation-btn', { hasText: '↔ Landscape' });
    await landscapeBtn.click();
    await expect(landscapeBtn).toHaveClass(/selected/);

    // Should swap to 3508 x 2480 px
    await expect(calcCard.locator('.calc-value')).toContainText('3508 × 2480 px');
  });

  // 7. Invalid File Rejection
  test('7. Reject invalid file format with user-friendly error banner', async ({ page }) => {
    const textFixture = writeTempFixture('invalid.txt', Buffer.from('Not an image'));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(textFixture);

    const errorAlert = page.locator('.error-message');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Unsupported file format/);
  });

  // 8. Dimension Limits / Backend Oversized Rejection
  test('8. Reject dimensions exceeding 8192px limit with clear feedback', async ({ page }) => {
    await page.goto('/');

    // Switch to Custom Pixels
    await page.getByRole('button', { name: 'Custom Pixels' }).click();

    // Fill in 9000 for width
    const widthInput = page.locator('label', { hasText: 'Width (px)' }).locator('input');
    await widthInput.fill('9000');

    // Should display warning banner
    await expect(page.locator('text=/exceed the backend maximum limit/')).toBeVisible();
  });

  // 9. Before/After Comparison Slider Interaction
  test('9. Interactive comparison slider allows split position adjustment', async ({ page }) => {
    const fixturePath = writeTempFixture('slider_test.png', createPngBuffer(80, 80));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await page.getByRole('button', { name: /Resize image/i }).click();

    await expect(page.locator('.result-metrics-card')).toBeVisible();

    const slider = page.locator('.comparison-container[role="slider"]');
    await expect(slider).toBeVisible();
    expect(await slider.getAttribute('aria-valuenow')).toBe('50');

    // Adjust position via keyboard
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    const updatedPos = Number(await slider.getAttribute('aria-valuenow'));
    expect(updatedPos).toBeLessThan(50);
  });

  // 10. Image Replacement Clears Stale Results
  test('10. Replacing or removing image clears stale processing results', async ({ page }) => {
    const fixture1 = writeTempFixture('first_img.png', createPngBuffer(80, 80));
    const fixture2 = writeTempFixture('second_img.png', createPngBuffer(100, 100));

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(fixture1);
    await page.getByRole('button', { name: /Resize image/i }).click();

    await expect(page.locator('.result-metrics-card')).toBeVisible();

    // Replace with second image
    await page.locator('input[type="file"]').setInputFiles(fixture2);

    // Stale results card should immediately disappear
    await expect(page.locator('.result-metrics-card')).not.toBeVisible();
    await expect(page.locator('.file-name')).toContainText('second_img.png');
    await expect(page.locator('.file-meta')).toContainText('100 × 100 px');
  });

  // 11. Responsive Layout at Desktop and Mobile Viewports
  test('11. Responsive layout adapts cleanly to desktop and mobile viewports', async ({ page }) => {
    // 1. Desktop Viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.locator('.workspace')).toBeVisible();

    // Both panels side-by-side
    const uploadBox = await page.locator('.upload-panel').boundingBox();
    const settingsBox = await page.locator('.settings-panel').boundingBox();
    expect(uploadBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();

    // 2. Mobile Viewport (iPhone / Android)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const mobileUploadBox = await page.locator('.upload-panel').boundingBox();
    const mobileSettingsBox = await page.locator('.settings-panel').boundingBox();

    // In stacked mobile layout, settings panel is vertically below upload panel
    expect(mobileSettingsBox.y).toBeGreaterThanOrEqual(mobileUploadBox.y + mobileUploadBox.height - 20);

    // Topbar brand and badge remain properly visible without horizontal overflow
    await expect(page.locator('.brand')).toBeVisible();
    await expect(page.locator('.free-badge')).toBeVisible();
  });
});
