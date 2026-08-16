import { hashSync } from 'bcryptjs';
import { UserRole } from '@stockpred/shared-types';
import type { PrismaClient } from '@prisma/client';

/** Local-only paper logins. Rotate these in any shared environment. */
export const DEMO_USERS = [
  {
    email: 'admin@stockpred.local',
    name: 'Demo Admin',
    role: UserRole.ADMIN,
    password: 'Admin@12345',
  },
  {
    email: 'trader@stockpred.local',
    name: 'Demo Trader',
    role: UserRole.TRADER,
    password: 'Trader@12345',
  },
  {
    email: 'viewer@stockpred.local',
    name: 'Demo Viewer',
    role: UserRole.VIEWER,
    password: 'Viewer@12345',
  },
] as const;

/** Create or reset the documented demo accounts so local paper login works. */
export async function ensureDemoUsers(prisma: PrismaClient): Promise<number> {
  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        passwordHash: hashSync(user.password, 10),
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: hashSync(user.password, 10),
      },
    });
  }
  return DEMO_USERS.length;
}
