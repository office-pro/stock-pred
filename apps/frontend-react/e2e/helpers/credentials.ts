/** Demo logins from packages/database/src/demo-users.ts. */
export const DEMO_USERS = {
  superadmin: {
    email: 'superadmin@stockpred.local',
    password: 'Super@12345',
    name: 'Demo Superadmin',
    role: 'SUPERADMIN' as const,
  },
  admin: {
    email: 'admin@stockpred.local',
    password: 'Admin@12345',
    name: 'Demo Admin',
    role: 'ADMIN' as const,
  },
  user: {
    email: 'user@stockpred.local',
    password: 'User@12345',
    name: 'Demo User',
    role: 'USER' as const,
  },
  viewer: {
    email: 'viewer@stockpred.local',
    password: 'Viewer@12345',
    name: 'Demo Viewer',
    role: 'VIEWER' as const,
  },
} as const;

export type DemoRole = keyof typeof DEMO_USERS;
