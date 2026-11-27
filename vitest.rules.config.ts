import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/firestore.rules.emulator.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    maxWorkers: 1,
    },
});
