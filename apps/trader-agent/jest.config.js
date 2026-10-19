/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    // Prefer built dist to avoid CJS circular init (AppView vs execution-identity).
    '^@stockpred/shared\\-types$': '<rootDir>/../../packages/shared-types/dist/index.js',
    '^@stockpred/shared-utils$': '<rootDir>/../../packages/shared-utils/dist/index.js',
  },
};
