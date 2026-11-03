/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/tests/setupHarness.js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.test.js',
    '**/src/**/*.test.js',
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/config/**',
    '!src/scripts/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,
  modulePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist/'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};