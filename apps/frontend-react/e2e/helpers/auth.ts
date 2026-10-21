import { expect, type Page } from '@playwright/test';
import { DEMO_USERS, type DemoRole } from './credentials';

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function loginAs(page: Page, role: DemoRole): Promise<void> {
  const creds = DEMO_USERS[role];
  await loginViaUi(page, creds.email, creds.password);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  await expect(page.getByTestId('auth-user-name')).toContainText(creds.name, {
    timeout: 20_000,
  });
}

export async function openBatchWorkstation(page: Page): Promise<void> {
  await page.goto('/batch');
  await expect(page.getByTestId('screen-overview')).toBeVisible({ timeout: 60_000 });
}
