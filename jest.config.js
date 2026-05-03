/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^vscode$': '<rootDir>/src/test/__mocks__/vscode.ts',
    '^node-fetch$': '<rootDir>/src/test/__mocks__/node-fetch.ts',
  },
};
