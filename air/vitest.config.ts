import { defineConfig } from 'vitest/config'

/** Workspace-level tests cover air/scripts only; each package runs its own Vitest config. */
export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts'],
    testTimeout: 20_000,
  },
})
