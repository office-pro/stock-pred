import { hashSync } from 'bcryptjs';
import { ALL_ASSIGNABLE_VIEWS, AppView, UserRole, UserStatus } from '@stockpred/shared-types';
import type { PrismaClient } from '@prisma/client';

const ALL_VIEWS = ALL_ASSIGNABLE_VIEWS.map(String);

/** Local-only paper logins. Rotate these in any shared environment. */
export const DEMO_USERS = [
  {
    email: 'superadmin@stockpred.local',
    name: 'Demo Superadmin',
    role: UserRole.SUPERADMIN,
    password: 'Super@12345',
    brandDomain: null as string | null,
    allowedViews: ALL_VIEWS,
    accessExpiresAt: null as Date | null,
  },
  {
    email: 'admin@stockpred.local',
    name: 'Demo Admin',
    role: UserRole.ADMIN,
    password: 'Admin@12345',
    brandDomain: 'demo.stockpred.local',
    allowedViews: ALL_VIEWS,
    accessExpiresAt: null as Date | null,
  },
  {
    email: 'user@stockpred.local',
    name: 'Demo User',
    role: UserRole.USER,
    password: 'User@12345',
    brandDomain: 'demo.stockpred.local',
    allowedViews: ALL_VIEWS,
    accessExpiresAt: null as Date | null,
  },
  {
    email: 'viewer@stockpred.local',
    name: 'Demo Viewer',
    role: UserRole.VIEWER,
    password: 'Viewer@12345',
    brandDomain: 'demo.stockpred.local',
    allowedViews: [AppView.DASHBOARD, AppView.SCANNER, AppView.SIGNALS, AppView.STOCK_DETAIL].map(
      String,
    ),
    accessExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  },
] as const;

/** Create or reset the documented demo accounts so local paper login works. */
export async function ensureDemoUsers(prisma: PrismaClient): Promise<number> {
  const brand = await prisma.brand.upsert({
    where: { domain: 'demo.stockpred.local' },
    update: {
      name: 'Demo Brand',
      paperCapital: 10_000_000,
      status: 'ACTIVE',
      contactEmail: 'admin@stockpred.local',
    },
    create: {
      name: 'Demo Brand',
      domain: 'demo.stockpred.local',
      paperCapital: 10_000_000,
      status: 'ACTIVE',
      contactEmail: 'admin@stockpred.local',
      notes: 'Local development brand',
    },
  });

  // Soft-migrate legacy trader demo account email if present.
  const legacyTrader = await prisma.user.findUnique({ where: { email: 'trader@stockpred.local' } });
  if (legacyTrader) {
    await prisma.user.update({
      where: { id: legacyTrader.id },
      data: {
        email: 'user@stockpred.local',
        name: 'Demo User',
        role: UserRole.USER,
        brandId: brand.id,
        status: UserStatus.ACTIVE,
        allowedViews: ALL_VIEWS,
        passwordHash: hashSync('User@12345', 10),
      },
    });
  }

  for (const user of DEMO_USERS) {
    const brandId = user.brandDomain ? brand.id : null;
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        status: UserStatus.ACTIVE,
        brandId,
        allowedViews: [...user.allowedViews],
        accessExpiresAt: user.accessExpiresAt,
        passwordHash: hashSync(user.password, 10),
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        status: UserStatus.ACTIVE,
        brandId,
        allowedViews: [...user.allowedViews],
        accessExpiresAt: user.accessExpiresAt,
        passwordHash: hashSync(user.password, 10),
      },
    });
  }
  return DEMO_USERS.length;
}
