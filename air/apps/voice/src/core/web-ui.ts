/**
 * "Open in AIR": serves dsh's shipped `web` profile against the voice home (once, reused) so the user can watch the voice
 * sessions and continue in text. The shipped profile needs no setup: `--from-default-profile web` is refused for it, and
 * the profile folder appears in the home on first start. The Web UI has no session route: its token URL redirects to the
 * clean root, and the session list lives in the page, so the button opens the root and the sessions appear in the sidebar.
 */
import type { ChildLike } from './child.ts'
import { lineReader } from './child.ts'

/** Starts a child with an explicit environment. */
export type EnvSpawn = (command: string, args: readonly string[], env: Record<string, string | undefined>) => ChildLike

const URL_LINE = /^dsh web: (https?:\/\/\S+)$/

/**
 * @param line - one line the Web server printed.
 * @returns the URL after `dsh web:` (it carries the access token), or undefined for any other line.
 */
export function parseWebUrl(line: string): string | undefined {
  const match = URL_LINE.exec(line.trim())
  if (match === null) return undefined
  try {
    return new URL(match[1] as string).href
  } catch {
    return undefined
  }
}

/**
 * @param url - a Web UI URL.
 * @returns the URL with the token value replaced, safe for a debug log.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '***')
    return parsed.href
  } catch {
    return '(unparsable url)'
  }
}

/**
 * @param base - the URL the server printed, with its token.
 * @returns the URL to open. The Web UI cannot be pointed at one session by URL (the token request redirects to the
 *   clean root), so this is the base URL; any session id is deliberately not added.
 */
export function buildOpenUrl(base: string): string {
  return base
}

/** Options of {@link WebUi}. */
export interface WebUiOptions {
  /** The dsh CLI entry (`apps/cli/lib/bin.js`). */
  dshBin: string
  /** The voice runtime home, used as `DSH_HOME`. */
  home: string
  /** Node executable; inside Electron this is the Electron binary, which needs `ELECTRON_RUN_AS_NODE`. */
  node: string
  spawnFn: EnvSpawn
  /** Opens a URL in the default browser. */
  openExternal: (url: string) => Promise<void>
  env?: Record<string, string | undefined>
  /** How long to wait for the server's URL line. */
  startTimeoutMs?: number
  /** Debug logger; receives only redacted URLs. */
  debug?: (message: string) => void
}

/** Runs the Web server for the voice home. */
export class WebUi {
  private child: ChildLike | undefined
  private url: Promise<string> | undefined

  constructor(private readonly options: WebUiOptions) {}

  private env(): Record<string, string | undefined> {
    return { ...this.options.env ?? process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: this.options.home }
  }

  private start(): Promise<string> {
    const args = [this.options.dshBin, '--profile', 'web', '--no-open', '--port', '0']
    const child = this.options.spawnFn(this.options.node, args, this.env())
    this.child = child
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('the web server did not start in time'))
      }, this.options.startTimeoutMs ?? 30_000)
      const fail = (): void => {
        clearTimeout(timer)
        this.child = undefined
        this.url = undefined
        reject(new Error('the web server stopped'))
      }
      child.stdout.on('data', lineReader((line) => {
        const url = parseWebUrl(line)
        if (url !== undefined) {
          clearTimeout(timer)
          this.options.debug?.(`web ui at ${redactUrl(url)}`)
          resolve(url)
        }
      }))
      child.on('exit', fail)
      child.on('error', fail)
    })
  }

  /**
   * Start the server if it is not running (once; later calls reuse it) and open its URL in the browser.
   * @throws when the server does not print its URL in time or exits.
   */
  async open(): Promise<void> {
    this.url ??= this.start()
    let url: string
    try {
      url = await this.url
    } catch (error) {
      this.url = undefined
      this.child?.kill()
      this.child = undefined
      throw error
    }
    await this.options.openExternal(buildOpenUrl(url))
  }

  /** Stop the server. */
  stop(): void {
    this.child?.kill()
    this.child = undefined
    this.url = undefined
  }
}
