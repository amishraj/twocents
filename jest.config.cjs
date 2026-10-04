// Jest config scoped to the Firestore rules emulator tests under test/rules/.
// Use `npm run test:rules` which wraps this in `firebase emulators:exec` so the
// emulator is booted before the test process starts.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/rules/**/*.test.ts'],
  testTimeout: 30000,
  // Don't pull in node_modules typings via the default Angular tsconfig.
  globals: {
    'ts-jest': {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        esModuleInterop: true,
        moduleResolution: 'node',
        strict: true,
        types: ['node', 'jest']
      }
    }
  }
};
