import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('demo, filtering, date safeguards and downloadable calendar', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).toBeVisible();
  await expect(page.locator('.mode-banner')).toContainText('演示数据');
  await expect(page.getByRole('button', { name: /导出日历/ })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择680 积分待关注' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择待核实有效期的优惠券' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '选择早餐搭配优惠券' }).check();
  await expect(page.locator('.selection-summary')).toContainText('1');
  await page.getByRole('button', { name: '活动日历', exact: true }).click();
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).not.toBeVisible();
  await expect(page.locator('.selection-note')).toContainText('1');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出日历/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mcd-radar-demo.ics');
  const calendar = await readFile((await download.path())!, 'utf8');
  expect(calendar).toContain('SUMMARY:【演示数据】');
  expect(calendar).toContain('BEGIN:VALARM');
  await expect(page.getByRole('status').filter({ hasText: '日历文件已生成' })).toBeVisible();
  await page.getByRole('button', { name: '关闭通知' }).click();
  await expect(page.locator('.mode-banner')).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join('docs', 'images', `demo-${info.project.name}.png`), fullPage: true });
  expect(errors).toEqual([]);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.view);
});

test('live mode fails explicitly without token and never retains demo cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).toBeVisible();
  await page.getByRole('button', { name: '真实账户', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('MCD_MCP_TOKEN');
  await expect(page.locator('.mode-banner')).toContainText('真实 MCP 模式');
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).not.toBeVisible();
  await expect(page.locator('.stat-value').first()).toContainText('—');
  await page.getByRole('button', { name: '体验演示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).toBeVisible();
});

test('range, expired items and accessible guide', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '早餐搭配优惠券' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '周末小食优惠券' })).not.toBeVisible();
  await page.getByRole('combobox', { name: '时间范围' }).selectOption('30');
  await expect(page.getByRole('heading', { name: '周末小食优惠券' })).toBeVisible();
  await page.getByRole('checkbox', { name: '包含已过日期' }).check();
  await expect(page.getByRole('heading', { name: '已过期示例券' })).toBeVisible();
  await page.getByRole('button', { name: '使用指南' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '使用指南' })).toBeFocused();
});
