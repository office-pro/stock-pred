/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@stockpred/shared\-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@stockpred/shared-utils$': '<rootDir>/../../packages/shared-utils/src/index.ts',
  },
};
