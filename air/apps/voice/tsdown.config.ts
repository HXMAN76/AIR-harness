import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/listener-worker.ts'],
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'], alwaysBundle: [/^@air\//] },
})
