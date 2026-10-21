import { expect, test } from '@playwright/test';
import { loginAs, loginViaUi } from './helpers/auth';
import { DEMO_USERS } from './helpers/credentials';

test.describe('Login by role (live auth)', () => {
  test('admin can sign in', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page).toHaveURL(/\/$/);
  });

  test('superadmin can sign in', async ({ page }) => {
    await loginAs(page, 'superadmin');
    await expect(page.getByTestId('auth-user-name')).toContainText('Demo Superadmin');
  });

  test('user role can sign in', async ({ page }) => {
    await loginAs(page, 'user');
    await expect(page.getByTestId('auth-user-name')).toContainText('Demo User');
  });

  test('viewer can sign in but cannot open batch', async ({ page }) => {
    await loginAs(page, 'viewer');
    await page.goto('/batch');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await expect(page.getByText('Access denied')).toBeVisible();
  });

  test('rejected credentials stay on login', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin.email, 'WrongPassword!');
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText('Invalid credentials');
    await expect(page).toHaveURL(/\/login/);
  });
});
