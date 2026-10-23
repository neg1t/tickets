import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('scoped UI styles leave a host alone and allow two widget themes', async ({ page }) => {
  await page.setContent(`
    <style>body{margin:19px}#host-button{background:rgb(255, 0, 0);border:0}</style>
    <button id="host-button">Host action</button>
    <section class="hall-theme"><button class="hall-ui hall-button hall-button--secondary hall-button--md">Widget one</button></section>
    <section class="hall-theme hall-theme-canvas"><button class="hall-ui hall-button hall-button--secondary hall-button--md">Widget two</button></section>
  `);
  await page.addStyleTag({ content: await readFile(resolve(test.info().config.rootDir, '../../../libs/design-tokens/styles.css'), 'utf8') });
  await page.addStyleTag({ content: await readFile(resolve(test.info().config.rootDir, '../../../libs/ui/styles.css'), 'utf8') });

  const styles = await page.evaluate(() => {
    const host = document.querySelector<HTMLButtonElement>('#host-button');
    const widgets = [...document.querySelectorAll<HTMLButtonElement>('.hall-button')];
    if (!host || widgets.length !== 2 || !widgets[0] || !widgets[1]) throw new Error('Missing fixture controls');
    return {
      hostBackground: getComputedStyle(host).backgroundColor,
      hostBorder: getComputedStyle(host).borderTopWidth,
      hostMargin: getComputedStyle(document.body).marginTop,
      widgetBackgrounds: widgets.map((widget) => getComputedStyle(widget).backgroundColor),
      seatColors: widgets.map((widget) => getComputedStyle(widget).getPropertyValue('--hall-canvas-seat').trim()),
    };
  });
  expect(styles.hostBackground).toBe('rgb(255, 0, 0)');
  expect(styles.hostBorder).toBe('0px');
  expect(styles.hostMargin).toBe('19px');
  expect(styles.widgetBackgrounds[0]).not.toBe(styles.widgetBackgrounds[1]);
  expect(styles.seatColors[0]).not.toBe(styles.seatColors[1]);
});
