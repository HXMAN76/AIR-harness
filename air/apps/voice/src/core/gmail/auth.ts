/**
 * Google OAuth for an installed app: loopback redirect with PKCE, token storage encrypted by the caller's cipher,
 * automatic refresh. Plain `fetch`, no Google client library. Nothing here prints a credential or a token.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'

/** The two scopes requested, exactly: read mail and send mail. */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] as const

/** File names inside the voice home. */
export const CREDENTIALS_FILE = 'google-credentials.json'
export const TOKEN_FILE = 'google-token.json'

/** The part of `fetch` used here and by the Gmail client. */
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** Why sign-in or a token call failed; `code` is stable for callers, the message is safe to speak. */
export class GmailAuthError extends Error {
  constructor(
    readonly code: 'not-configured' | 'denied' | 'timeout' | 'scope' | 'reauth' | 'storage' | 'network',
    message: string,
  ) {
    super(message)
    this.name = 'GmailAuthError'
  }
}

/** A Google "Desktop app" OAuth client. */
export interface OAuthClient {
  clientId: string
  clientSecret: string
  authUri: string
  tokenUri: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Read the OAuth client from a `credentials.json` (`{"installed": {...}}`). The contents are never printed.
 * @param json - file text.
 * @returns the client.
 * @throws {GmailAuthError} `not-configured` when the file is not a Desktop app credentials file with HTTPS endpoints.
 */
export function parseCredentials(json: string): OAuthClient {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    parsed = undefined
  }
  const installed = record(record(parsed)?.installed)
  const client = {
    clientId: text(installed?.client_id),
    clientSecret: text(installed?.client_secret),
    authUri: text(installed?.auth_uri),
    tokenUri: text(installed?.token_uri),
  }
  if (client.clientId === '' || !client.authUri.startsWith('https://') || !client.tokenUri.startsWith('https://')) {
    throw new GmailAuthError('not-configured', 'The Google credentials file is not a Desktop app client.')
  }
  return client
}

/** Encrypts the token file; the Electron main process passes `safeStorage` (Windows DPAPI). */
export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/** What is kept between runs. */
export interface StoredToken {
  refreshToken: string
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/** The token file: JSON `{"v":1,"data":"<base64 of the encrypted token>"}`. Nothing is written when encryption is unavailable. */
export class TokenStore {
  constructor(private readonly path: string, private readonly cipher: Cipher) {}

  /** @returns whether a token file exists. */
  exists(): boolean {
    return existsSync(this.path)
  }

  /** @returns the stored token, or undefined when missing, unreadable, or not decryptable (for example from another user account). */
  load(): StoredToken | undefined {
    try {
      const data = record(JSON.parse(readFileSync(this.path, 'utf8')))?.data
      const token = record(JSON.parse(this.cipher.decrypt(Buffer.from(text(data), 'base64'))))
      const refreshToken = text(token?.refreshToken)
      return refreshToken === ''
        ? undefined
        : { refreshToken, accessToken: text(token?.accessToken), expiresAt: Number(token?.expiresAt) || 0 }
    } catch {
      return undefined
    }
  }

  /**
   * @param token - token to keep.
   * @throws {GmailAuthError} `storage` when encryption is unavailable.
   */
  save(token: StoredToken): void {
    if (!this.cipher.available()) throw new GmailAuthError('storage', 'Secure storage is not available, so the Gmail token was not saved.')
    mkdirSync(dirname(this.path), { recursive: true })
    const data = this.cipher.encrypt(JSON.stringify(token)).toString('base64')
    writeFileSync(this.path, JSON.stringify({ v: 1, data }))
  }

  /** Remove the token file. */
  delete(): void {
    rmSync(this.path, { force: true })
  }
}

/**
 * @param bytes - random bytes.
 * @returns base64url text.
 */
function b64(bytes: Buffer): string {
  return bytes.toString('base64url')
}

/**
 * @param verifier - PKCE code verifier.
 * @returns the S256 code challenge.
 */
export function pkceChallenge(verifier: string): string {
  return b64(createHash('sha256').update(verifier).digest())
}

/**
 * @param client - OAuth client.
 * @param options - redirect URI, PKCE challenge, and state.
 * @returns the consent URL.
 */
export function authUrl(client: OAuthClient, options: { redirectUri: string; challenge: string; state: string }): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: options.redirectUri,
    scope: GMAIL_SCOPES.join(' '),
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${client.authUri}?${query.toString()}`
}

const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>AIR</title><body style="font-family:sans-serif;background:#0b0d12;color:#e8eaf0;text-align:center;padding-top:20vh">You can close this tab and return to AIR.</body>'

/** Everything {@link GmailAuth} needs from outside. */
export interface GmailAuthDeps {
  home: string
  cipher: Cipher
  fetchFn: FetchFn
  /** Opens the consent URL in the user's browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => Promise<void>
  now?: () => number
  /** How long to wait for the user to approve in the browser. */
  authorizeTimeoutMs?: number
}

/** Seconds before expiry at which the access token is renewed. */
const SKEW_MS = 60_000

/** Signs in once, keeps the refresh token, and hands out fresh access tokens. */
export class GmailAuth {
  private readonly store: TokenStore
  private readonly credentialsPath: string
  private readonly now: () => number
  private cached: StoredToken | undefined
  private signingIn: Promise<void> | undefined

  constructor(private readonly deps: GmailAuthDeps) {
    this.store = new TokenStore(join(deps.home, TOKEN_FILE), deps.cipher)
    this.credentialsPath = join(deps.home, CREDENTIALS_FILE)
    this.now = deps.now ?? Date.now
  }

  /** @returns whether the OAuth client file is in the voice home (presence only). */
  configured(): boolean {
    return existsSync(this.credentialsPath)
  }

  /** @returns whether a token is stored (presence only). */
  connected(): boolean {
    return this.store.exists()
  }

  /** Forget the token (the "disconnect gmail" command). */
  disconnect(): void {
    this.cached = undefined
    this.store.delete()
  }

  private client(): OAuthClient {
    if (!this.configured()) throw new GmailAuthError('not-configured', 'Gmail is not set up.')
    return parseCredentials(readFileSync(this.credentialsPath, 'utf8'))
  }

  /**
   * Sign in if there is no stored token, then return a valid access token, refreshing it when it is about to expire.
   * @param force - discard the cached access token and refresh (after a 401).
   * @param announce - called just before the browser is opened for consent.
   * @returns the access token; never log it.
   * @throws {GmailAuthError} when sign-in or refresh fails.
   */
  async accessToken(force = false, announce?: () => Promise<void>): Promise<string> {
    let token = this.cached ?? this.store.load()
    if (token === undefined) {
      this.signingIn ??= this.authorize(announce).finally(() => {
        this.signingIn = undefined
      })
      await this.signingIn
      token = this.cached
    }
    /* v8 ignore next -- authorize either sets the cache or throws. */
    if (token === undefined) throw new GmailAuthError('reauth', 'Gmail needs to be connected.')
    if (!force && token.accessToken !== '' && token.expiresAt - SKEW_MS > this.now()) {
      this.cached = token
      return token.accessToken
    }
    const fresh = await this.refresh(token)
    return fresh.accessToken
  }

  private async tokenCall(client: OAuthClient, form: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Awaited<ReturnType<FetchFn>>
    try {
      response = await this.deps.fetchFn(client.tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...form }).toString(),
      })
    } catch {
      throw new GmailAuthError('network', "I couldn't reach Google.")
    }
    const body = record(await response.json().catch(() => undefined)) ?? {}
    if (!response.ok) {
      if (text(body.error) === 'invalid_grant') {
        this.disconnect()
        throw new GmailAuthError('reauth', 'Gmail needs to be connected again.')
      }
      throw new GmailAuthError('network', "Google didn't accept the request.")
    }
    return body
  }

  private async refresh(token: StoredToken): Promise<StoredToken> {
    const body = await this.tokenCall(this.client(), { grant_type: 'refresh_token', refresh_token: token.refreshToken })
    const fresh: StoredToken = {
      refreshToken: text(body.refresh_token) || token.refreshToken,
      accessToken: text(body.access_token),
      expiresAt: this.now() + (Number(body.expires_in) || 3600) * 1000,
    }
    this.store.save(fresh)
    this.cached = fresh
    return fresh
  }

  /**
   * Run the consent flow: open the browser, wait for the loopback redirect, exchange the code, store the token.
   * @param announce - called just before the browser is opened.
   * @throws {GmailAuthError} `denied`, `timeout`, `scope` (a scope was not granted), or a token error.
   */
  async authorize(announce?: () => Promise<void>): Promise<void> {
    const client = this.client()
    const verifier = b64(randomBytes(32))
    const state = b64(randomBytes(16))
    const server = createServer()
    const code = await this.consent(server, client, verifier, state, announce)
    const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    server.close()
    const body = await this.tokenCall(client, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })
    const granted = text(body.scope).split(' ')
    if (!GMAIL_SCOPES.every(scope => granted.includes(scope)) || text(body.refresh_token) === '') {
      throw new GmailAuthError('scope', 'Gmail needs both read and send permission.')
    }
    const token: StoredToken = {
      refreshToken: text(body.refresh_token),
      accessToken: text(body.access_token),
      expiresAt: this.now() + (Number(body.expires_in) || 3600) * 1000,
    }
    this.store.save(token)
    this.cached = token
  }

  /** Listen on a random loopback port, open the consent URL, and resolve with the authorization code. */
  private consent(server: Server, client: OAuthClient, verifier: string, state: string, announce?: () => Promise<void>): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        server.close()
        reject(new GmailAuthError('timeout', "Gmail sign-in didn't finish."))
      }, this.deps.authorizeTimeoutMs ?? 180_000)
      const finish = (action: () => void): void => {
        clearTimeout(timer)
        action()
      }
      server.on('request', (request, response) => {
        /* v8 ignore next -- a server request always has a URL. */
        const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams
        if (query.get('state') !== state || (!query.has('code') && !query.has('error'))) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
        const code = query.get('code')
        finish(() => {
          if (code === null) {
            server.close()
            reject(new GmailAuthError('denied', 'Gmail access was not approved.'))
          } else resolve(code)
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
        const url = authUrl(client, { redirectUri, challenge: pkceChallenge(verifier), state })
        void (announce?.() ?? Promise.resolve()).then(() => this.deps.openExternal(url)).catch(() => {
          finish(() => {
            server.close()
            reject(new GmailAuthError('network', "I couldn't open the browser."))
          })
        })
      })
    })
  }
}
