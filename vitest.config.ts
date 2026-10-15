// Vitest configuration. Each property test sets its own numRuns and timeout,
// so no global testTimeout is set here.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
