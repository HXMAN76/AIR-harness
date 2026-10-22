/** OAuth tests: a fake token endpoint (fake fetch) and a real loopback listener driven by a fake "browser". No network. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CREDENTIALS_FILE, GMAIL_SCOPES, GmailAuth, GmailAuthError, TOKEN_FILE, TokenStore, authUrl, parseCredentials, pkceChallenge,
  type Cipher, type FetchFn,
} from '../src/core/gmail/auth.ts'

const CREDENTIALS = JSON.stringify({
  installed: {
    client_id: 'client-id.apps.googleusercontent.com',
    client_secret: 'client-secret-value',
    auth_uri: 'https://accounts.example.test/o/oauth2/auth',
    token_uri: 'https://oauth2.example.test/token',
  },
})

const cipher: Cipher = {
  available: () => true,
  encrypt: plain => Buffer.from(plain, 'utf8').reverse(),
  decrypt: data => Buffer.from(data).reverse().toString('utf8'),
}

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'air-gmail-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

interface Call { url: string; form: URLSearchParams }

/** A fake token endpoint: answers each call from the queue and records the form. */
interface Answer { ok?: boolean; body?: unknown; throws?: boolean; badJson?: boolean }
function tokenEndpoint(...answers: Answer[]): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, form: new URLSearchParams(init?.body ?? '') })
    const answer = answers.shift() ?? { ok: false, body: {} }
    if (answer.throws === true) throw new Error('offline')
    return {
      ok: answer.ok ?? true,
      status: answer.ok === false ? 400 : 200,
      json: async () => {
        if (answer.badJson === true) throw new Error('not json')
        return answer.body
      },
    }
  }
  return { fetchFn, calls }
}

const GRANT = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  scope: GMAIL_SCOPES.join(' '),
}

/** Plays the browser: opens the redirect URI of the consent URL with the given extra query. */
function browser(reply: (redirect: string, state: string) => string[]): { open: (url: string) => Promise<void>; urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    open: async (url) => {
      urls.push(url)
      const query = new URL(url).searchParams
      const redirect = query.get('redirect_uri') as string
      const state = query.get('state') as string
      for (const target of reply(redirect, state)) {
        await new Promise<void>((resolve) => {
          get(target, (response) => {
            response.resume()
            response.on('end', resolve)
          }).on('error', () => { resolve() })
        })
      }
    },
  }
}

function makeAuth(
  fetchFn: FetchFn,
  openExternal: (url: string) => Promise<void>,
  extra: { now?: () => number; timeout?: number; c?: Cipher } = {},
): GmailAuth {
  return new GmailAuth({
    home,
    cipher: extra.c ?? cipher,
    fetchFn,
    openExternal,
    ...(extra.now === undefined ? {} : { now: extra.now }),
    ...(extra.timeout === undefined ? {} : { authorizeTimeoutMs: extra.timeout }),
  })
}

const writeCredentials = (): void => {
  writeFileSync(join(home, CREDENTIALS_FILE), CREDENTIALS)
}

describe('credentials', () => {
  it('reads a Desktop app client', () => {
    expect(parseCredentials(CREDENTIALS)).toEqual({
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret-value',
      authUri: 'https://accounts.example.test/o/oauth2/auth',
      tokenUri: 'https://oauth2.example.test/token',
    })
  })

  it('refuses anything else without echoing the content', () => {
    for (const bad of ['not json', '{}', '[]', JSON.stringify({ web: {} }), JSON.stringify({ installed: { client_id: 'x', auth_uri: 'http://a', token_uri: 'https://t' } })]) {
      expect(() => parseCredentials(bad)).toThrow(GmailAuthError)
    }
    try {
      parseCredentials('{"installed":{"client_secret":"SECRET-TEXT"}}')
    } catch (error) {
      expect(String(error)).not.toContain('SECRET-TEXT')
    }
  })

  it('builds the consent URL with PKCE, the two scopes, and offline access', () => {
    const url = new URL(authUrl(parseCredentials(CREDENTIALS), { redirectUri: 'http://127.0.0.1:5', challenge: 'ch', state: 'st' }))
    expect(url.origin + url.pathname).toBe('https://accounts.example.test/o/oauth2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5')
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('token store', () => {
  it('round-trips an encrypted token and deletes it', () => {
    const store = new TokenStore(join(home, 'sub', TOKEN_FILE), cipher)
    expect(store.exists()).toBe(false)
    expect(store.load()).toBeUndefined()
    store.save({ refreshToken: 'r', accessToken: 'a', expiresAt: 5 })
    expect(store.exists()).toBe(true)
    expect(readFileSync(join(home, 'sub', TOKEN_FILE), 'utf8')).not.toContain('"r"')
    expect(store.load()).toEqual({ refreshToken: 'r', accessToken: 'a', expiresAt: 5 })
    store.delete()
    expect(store.exists()).toBe(false)
  })

  it('refuses to save without secure storage, and treats junk or an undecryptable file as no token', () => {
    const locked = new TokenStore(join(home, TOKEN_FILE), { ...cipher, available: () => false })
    expect(() => {
      locked.save({ refreshToken: 'r', accessToken: 'a', expiresAt: 1 })
    }).toThrow('Secure storage')
    expect(existsSync(join(home, TOKEN_FILE))).toBe(false)
    const store = new TokenStore(join(home, TOKEN_FILE), cipher)
    writeFileSync(join(home, TOKEN_FILE), 'junk')
    expect(store.load()).toBeUndefined()
    writeFileSync(join(home, TOKEN_FILE), JSON.stringify({ v: 1, data: Buffer.from('{"accessToken":"x"}').reverse().toString('base64') }))
    expect(store.load()).toBeUndefined()
    writeFileSync(join(home, TOKEN_FILE), JSON.stringify({ v: 1 }))
    expect(store.load()).toBeUndefined()
    store.save({ refreshToken: 'r', accessToken: '', expiresAt: Number.NaN })
    expect(store.load()).toEqual({ refreshToken: 'r', accessToken: '', expiresAt: 0 })
  })
})

describe('sign-in', () => {
  it('reports presence only', () => {
    const auth = makeAuth(tokenEndpoint().fetchFn, async () => undefined)
    expect(auth.configured()).toBe(false)
    expect(auth.connected()).toBe(false)
    writeCredentials()
    expect(auth.configured()).toBe(true)
  })

  it('without credentials, connecting fails as not configured', async () => {
    const auth = makeAuth(tokenEndpoint().fetchFn, async () => undefined)
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('runs consent on first use: announces, opens the browser, exchanges the code with the verifier, stores the token', async () => {
    writeCredentials()
    const endpoint = tokenEndpoint({ body: GRANT })
    const web = browser((redirect, state) => [`${redirect}/favicon.ico`, `${redirect}/?code=wrong&state=bad`, `${redirect}/?code=the-code&state=${state}`])
    const order: string[] = []
    const auth = makeAuth(endpoint.fetchFn, async (url) => { order.push('open'); await web.open(url) }, { now: () => 1_000 })
    expect(await auth.accessToken(false, async () => { order.push('announce') })).toBe('access-1')
    expect(order).toEqual(['announce', 'open'])
    const call = endpoint.calls[0] as Call
    expect(call.url).toBe('https://oauth2.example.test/token')
    expect(call.form.get('grant_type')).toBe('authorization_code')
    expect(call.form.get('code')).toBe('the-code')
    expect(call.form.get('client_secret')).toBe('client-secret-value')
    expect(call.form.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const challenge = new URL(web.urls[0] as string).searchParams.get('code_challenge')
    expect(pkceChallenge(call.form.get('code_verifier') as string)).toBe(challenge)
    expect(auth.connected()).toBe(true)
    // Second call uses the cached token: no further endpoint call.
    expect(await auth.accessToken()).toBe('access-1')
    expect(endpoint.calls).toHaveLength(1)
  })

  it('refreshes an expired token, keeps the refresh token, and forces a refresh on request', async () => {
    writeCredentials()
    new TokenStore(join(home, TOKEN_FILE), cipher).save({ refreshToken: 'refresh-0', accessToken: 'old', expiresAt: 100_000 })
    const endpoint = tokenEndpoint({ body: { access_token: 'new-1', expires_in: 3600 } }, { body: { access_token: 'new-2', refresh_token: 'refresh-9' } })
    let now = 10_000
    const auth = makeAuth(endpoint.fetchFn, async () => { throw new Error('no browser') }, { now: () => now })
    expect(await auth.accessToken()).toBe('old')
    now = 90_000
    expect(await auth.accessToken()).toBe('new-1')
    expect(endpoint.calls[0]?.form.get('grant_type')).toBe('refresh_token')
    expect(endpoint.calls[0]?.form.get('refresh_token')).toBe('refresh-0')
    expect(await auth.accessToken()).toBe('new-1')
    expect(await auth.accessToken(true)).toBe('new-2')
    expect(endpoint.calls[1]?.form.get('refresh_token')).toBe('refresh-0')
    expect(new TokenStore(join(home, TOKEN_FILE), cipher).load()?.refreshToken).toBe('refresh-9')
  })

  it('deletes the token and asks to reconnect when Google rejects the refresh token', async () => {
    writeCredentials()
    new TokenStore(join(home, TOKEN_FILE), cipher).save({ refreshToken: 'r', accessToken: '', expiresAt: 0 })
    const auth = makeAuth(tokenEndpoint({ ok: false, body: { error: 'invalid_grant' } }).fetchFn, async () => undefined)
    await expect(auth.accessToken()).rejects.toMatchObject({ code: 'reauth' })
    expect(auth.connected()).toBe(false)
  })

  it('maps other token failures to network errors', async () => {
    writeCredentials()
    new TokenStore(join(home, TOKEN_FILE), cipher).save({ refreshToken: 'r', accessToken: '', expiresAt: 0 })
    const rejected = makeAuth(tokenEndpoint({ ok: false, badJson: true }).fetchFn, async () => undefined)
    await expect(rejected.accessToken()).rejects.toMatchObject({ code: 'network', message: "Google didn't accept the request." })
    const offline = makeAuth(tokenEndpoint({ throws: true }).fetchFn, async () => undefined)
    await expect(offline.accessToken()).rejects.toMatchObject({ code: 'network', message: "I couldn't reach Google." })
    const empty = makeAuth(tokenEndpoint({ body: [] }).fetchFn, async () => undefined, { now: () => 0 })
    expect(await empty.accessToken()).toBe('')
  })

  it('fails when the user denies access, with no token stored', async () => {
    writeCredentials()
    const auth = makeAuth(tokenEndpoint().fetchFn, async (url) => {
      const state = new URL(url).searchParams.get('state') as string
      await browser(redirect => [`${redirect}/?error=access_denied&state=${state}`]).open(url)
    })
    await expect(auth.authorize()).rejects.toMatchObject({ code: 'denied' })
    expect(auth.connected()).toBe(false)
  })

  it('fails when a scope was not granted or no refresh token came back', async () => {
    writeCredentials()
    const consent = (): ((url: string) => Promise<void>) => async (url) => {
      await browser((redirect, state) => [`${redirect}/?code=c&state=${state}`]).open(url)
    }
    const partial = makeAuth(tokenEndpoint({ body: { ...GRANT, scope: GMAIL_SCOPES[0] } }).fetchFn, consent())
    await expect(partial.authorize()).rejects.toMatchObject({ code: 'scope' })
    const noRefresh = makeAuth(tokenEndpoint({ body: { ...GRANT, refresh_token: undefined } }).fetchFn, consent())
    await expect(noRefresh.authorize()).rejects.toMatchObject({ code: 'scope' })
    expect(noRefresh.connected()).toBe(false)
  })

  it('times out when nobody approves, and reports a browser that cannot be opened', async () => {
    writeCredentials()
    const slow = makeAuth(tokenEndpoint().fetchFn, async () => undefined, { timeout: 30 })
    await expect(slow.authorize()).rejects.toMatchObject({ code: 'timeout' })
    const broken = makeAuth(tokenEndpoint().fetchFn, async () => { throw new Error('no browser') })
    await expect(broken.authorize()).rejects.toMatchObject({ code: 'network', message: "I couldn't open the browser." })
  })

  it('assumes one hour when Google gives no lifetime', async () => {
    writeCredentials()
    const endpoint = tokenEndpoint({ body: { ...GRANT, expires_in: undefined } })
    const auth = makeAuth(endpoint.fetchFn, async (url) => {
      await browser((redirect, state) => [`${redirect}/?code=c&state=${state}`]).open(url)
    }, { now: () => 0 })
    expect(await auth.accessToken()).toBe('access-1')
    expect(endpoint.calls).toHaveLength(1)
  })

  it('shares one sign-in between concurrent callers and disconnects', async () => {
    writeCredentials()
    const endpoint = tokenEndpoint({ body: GRANT })
    let opens = 0
    const auth = makeAuth(endpoint.fetchFn, async (url) => {
      opens++
      await browser((redirect, state) => [`${redirect}/?code=c&state=${state}`]).open(url)
    }, { now: () => 0 })
    const tokens = await Promise.all([auth.accessToken(), auth.accessToken()])
    expect(tokens).toEqual(['access-1', 'access-1'])
    expect(opens).toBe(1)
    auth.disconnect()
    expect(auth.connected()).toBe(false)
    expect(existsSync(join(home, TOKEN_FILE))).toBe(false)
  })

  it('does not save the token when secure storage is unavailable', async () => {
    writeCredentials()
    const auth = makeAuth(tokenEndpoint({ body: GRANT }).fetchFn, async (url) => {
      await browser((redirect, state) => [`${redirect}/?code=c&state=${state}`]).open(url)
    }, { c: { ...cipher, available: () => false } })
    await expect(auth.authorize()).rejects.toMatchObject({ code: 'storage' })
    expect(existsSync(join(home, TOKEN_FILE))).toBe(false)
  })
})
