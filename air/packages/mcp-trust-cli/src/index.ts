/**
 * Command-line provider of the `air-mcp` profile. It parses
 * `list | pin | diff | verify | revoke`, waits for the launcher's successful-startup
 * signal (every mcp-client row has finished its first review by then), runs
 * the command against the `mcpTrust` service, and requests process exit with
 * the command's code.
 *
 * Function plugin: named exports only.
 * @module @air/dsh-mcp-trust-cli
 */

import { createInterface } from 'node:readline/promises'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type {} from '@air/dsh-mcp-trust'
import { internals } from './internals.ts'
import { runTrustCli, type CliIo, type TrustCliInvocation } from './run.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'air-mcp-trust-cli'

/** Services required before a command can run. */
export const inject = ['cmdlineArgs', 'mcpTrust']

const KEY_HELP = 'review key prefix (at least 8 hex characters) of a project server\'s lockfile entry; only revoke acts on one'

/**
 * This app's command tree.
 * @param accept - receives the parsed command from the invoked subcommand's action.
 * @returns a fresh program.
 */
function trustCommand(accept: (invocation: TrustCliInvocation) => void): Command {
  const program = new Command()
    .name('dsh --profile air-mcp')
    .description('Review and approve the tool definitions of configured MCP servers.')
    .helpOption('-h, --help', 'show this help')
  program.command('list')
    .description('print every lockfile entry: server, key prefix, tool count, newest approval; writes nothing')
    .action(() => { accept({ kind: 'list' }) })
  program.command('pin <server>')
    .description('approve the server\'s current tool surface in the lockfile')
    .option('--key <prefix>', KEY_HELP)
    .option('--tool <name...>', 'approve only these raw tool names')
    .option('--yes', 'write without asking')
    .action((server: string, options: { key?: string; tool?: string[]; yes?: boolean }) => {
      accept({
        kind: 'pin',
        server,
        ...options.key === undefined ? {} : { key: options.key },
        ...options.tool === undefined ? {} : { tools: options.tool },
        yes: options.yes === true,
      })
    })
  program.command('diff <server>')
    .description('show how the server\'s current surface differs from its pin; writes nothing')
    .option('--key <prefix>', KEY_HELP)
    .action((server: string, options: { key?: string }) => {
      accept({ kind: 'diff', server, ...options.key === undefined ? {} : { key: options.key } })
    })
  program.command('verify [server]')
    .description('exit non-zero when a surface differs from its pin; writes nothing')
    .option('--key <prefix>', KEY_HELP)
    .option('--all', 'verify every configured server')
    .action((server: string | undefined, options: { key?: string; all?: boolean }) => {
      accept({
        kind: 'verify',
        all: options.all === true,
        ...server === undefined ? {} : { server },
        ...options.key === undefined ? {} : { key: options.key },
      })
    })
  program.command('revoke <server>')
    .description('remove approvals from the lockfile; running processes deny the tools at once')
    .option('--key <prefix>', KEY_HELP)
    .option('--tool <name...>', 'revoke only these raw tool names')
    .action((server: string, options: { key?: string; tool?: string[] }) => {
      accept({
        kind: 'revoke',
        server,
        ...options.key === undefined ? {} : { key: options.key },
        ...options.tool === undefined ? {} : { tools: options.tool },
      })
    })
  return program
}

/** Terminal operations over the replaceable process streams. */
const io: CliIo = {
  out: (text) => { internals.stdout.write(`${text}\n`) },
  err: (text) => { internals.stderr.write(`${text}\n`) },
  isTty: () => internals.stdin.isTTY === true,
  async confirm(question) {
    const readline = createInterface({ input: internals.stdin })
    internals.stderr.write(question)
    try {
      return /^y(es)?$/i.test((await readline.question('')).trim())
    } finally {
      readline.close()
    }
  },
}

/**
 * Parse the command line and schedule the command after successful startup.
 * Help and usage errors request exit through `parseCmdline` and schedule nothing.
 * @param ctx - plugin context carrying the command line and the trust service.
 * @throws when the launcher did not provide readiness and exit, or no trust service exists.
 */
export function apply(ctx: Context): void {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  const trust = ctx.get('mcpTrust')
  if (ready === undefined || exit === undefined || trust === undefined) {
    throw new Error('air-mcp: the launcher must provide ctx.appReady and ctx.appExit, and the tree must provide mcpTrust')
  }
  const holder: { invocation?: TrustCliInvocation } = {}
  parseCmdline(ctx, trustCommand((value) => { holder.invocation = value }))
  const { invocation } = holder
  if (invocation === undefined) return
  ctx.effect(() => ready.onReady(() => {
    void runTrustCli(trust, invocation, io).then(exit)
  }), 'air-mcp-trust-cli.run')
}
