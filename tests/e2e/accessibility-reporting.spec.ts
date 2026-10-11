import { expect, test } from '@playwright/test';
import { renderReportingDashboard } from '@omnireach/ui';

test('reporting remains keyboard-readable with semantic unavailable states', async ({ page }) => {
  await page.setContent(
    `<main>${renderReportingDashboard(
      [
        {
          freshness: 'unknown',
          kind: 'traffic',
          label: 'Traffic',
          source: 'Google Analytics',
          state: 'not_connected',
        },
        {
          caveat: 'Sample only; not a ranking.',
          freshness: 'current',
          kind: 'sampled_mention',
          label: 'Sampled mentions',
          source: 'Fixture method v1',
          state: 'available',
          value: '1 of 3',
          windowEnd: '2026-10-10',
          windowStart: '2026-10-10',
        },
      ],
      'customer_viewer',
    )}</main>`,
  );
  await expect(page.getByRole('heading', { name: 'Site reporting' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveAccessibleName(/Measurements with source/u);
  await expect(page.getByText('Not connected')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Scrollable site measurements' })).toBeFocused();
  const background = await page
    .getByRole('region', { name: 'Scrollable site measurements' })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBeTruthy();
});
