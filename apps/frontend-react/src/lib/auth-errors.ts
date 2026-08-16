/** Map RTK Query / Nest login failures to a user-visible sentence. */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const status = 'status' in error ? error.status : undefined;
  const data = 'data' in error ? error.data : undefined;
  const fromBody = nestMessage(data);
  if (status === 401) return fromBody || 'Invalid credentials.';
  if (status === 502 || status === 503) {
    return fromBody || 'Login service is unavailable. Start Postgres and auth-service.';
  }
  if (typeof status === 'number' && fromBody) return fromBody;
  if ('message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fromBody || fallback;
}

function nestMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  if (!('message' in data)) return undefined;
  const message = data.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(' ');
  }
  return undefined;
}
