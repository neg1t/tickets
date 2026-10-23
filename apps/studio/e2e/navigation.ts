import type { Page } from '@playwright/test';

export async function openCatalogServices(page: Page) {
  const trigger = page.getByRole('button', { name: 'Демо и обслуживание' });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function openCurrentEditor(page: Page) {
  await openCatalogServices(page);
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
}

export async function openBuyer(page: Page) {
  await openCatalogServices(page);
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
}

export async function openEditorServices(page: Page) {
  const trigger = page.getByRole('button', { name: 'Демо и обслуживание' });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function chooseEditorAction(page: Page, name: string) {
  await openEditorServices(page);
  await page.getByRole('menuitem', { name }).click();
}

export async function chooseCatalogAction(page: Page, name: string) {
  await openCatalogServices(page);
  await page.getByRole('button', { name }).click();
}
