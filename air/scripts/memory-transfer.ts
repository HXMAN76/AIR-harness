/**
 * Export or import the AIR memory files as one JSON archive (Windows and Linux).
 * Usage: pnpm -C air run memory:transfer export|import <file> [--keep-trust] [--root <dir>]
 */
import { resolve } from 'node:path'
import { defaultMemoryRoot } from '../packages/memory-store/src/files.ts'
import { exportMemories, importMemories } from '../packages/memory-store/src/transfer.ts'

const USAGE = 'usage: pnpm -C air run memory:transfer export|import <file> [--keep-trust] [--root <dir>]'
const [command, file, ...flags] = process.argv.slice(2)
if ((command !== 'export' && command !== 'import') || file === undefined) {
  console.error(USAGE)
  process.exit(2)
}
// pnpm -C changes the working directory; relative paths are meant relative to where the command was typed.
const base = process.env['INIT_CWD'] ?? process.cwd()
const rootFlag = flags.indexOf('--root')
const root = rootFlag >= 0 && flags[rootFlag + 1] !== undefined ? resolve(base, String(flags[rootFlag + 1])) : defaultMemoryRoot()
const target = resolve(base, file)

if (command === 'export') {
  const report = await exportMemories(root, target)
  console.log(`exported ${String(report.files)} memory files from ${root} to ${target}`)
} else {
  const report = await importMemories(root, target, { keepTrust: flags.includes('--keep-trust'), lockWaitMs: 10_000 })
  console.log(`imported ${String(report.imported)}, skipped ${String(report.skippedExisting)} existing, ${String(report.invalid.length)} invalid`)
  for (const line of report.invalid) console.log(`invalid: ${line}`)
  if (report.imported > 0) console.log('git records the imported files with the next memory write')
}
