/** True when Prisma cannot reach or authenticate to Postgres. */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message) : '';
  const code = 'code' in error ? String(error.code) : '';
  return (
    name === 'PrismaClientInitializationError' ||
    code === 'P1000' ||
    code === 'P1001' ||
    code === 'P1017' ||
    message.includes('Authentication failed against database') ||
    message.includes("Can't reach database server") ||
    message.includes('provided database credentials')
  );
}
