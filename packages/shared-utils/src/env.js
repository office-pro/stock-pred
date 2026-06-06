'use strict';
/** Environment access helpers - secrets must only ever come from env vars. */
Object.defineProperty(exports, '__esModule', { value: true });
exports.getEnv = getEnv;
exports.getEnvNumber = getEnvNumber;
exports.getEnvBool = getEnvBool;
exports.getCorsOrigins = getCorsOrigins;
function getEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
function getEnvNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} is not a number: ${value}`);
  }
  return parsed;
}
function getEnvBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}
/**
 * CORS_ORIGIN supports a comma-separated list so the built frontend (:8080)
 * and the Vite dev server (:5173) can both talk to the services.
 */
function getCorsOrigins(fallback = 'http://localhost:8080,http://localhost:5173') {
  return getEnv('CORS_ORIGIN', fallback)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
//# sourceMappingURL=env.js.map
