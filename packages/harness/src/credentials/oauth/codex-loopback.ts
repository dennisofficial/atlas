// Loopback listener for the ChatGPT browser sign-in, as `codex login` runs it (openai/codex
// codex-rs/login/src/server.rs): bind 127.0.0.1:1455, fall back to 1457, receive the redirect at
// /auth/callback, answer it with a 302 to /success on the same server, and only then shut down.
// Stopping before /success is served leaves the browser on ERR_CONNECTION_REFUSED.

const PORTS = [1455, 1457] as const
const CALLBACK_PATH = '/auth/callback'
const SUCCESS_PATH = '/success'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
const SUCCESS_PAGE_GRACE_MS = 5000

const HTML_TYPE = { 'content-type': 'text/html; charset=utf-8' }
const SUCCESS_HTML =
  '<!doctype html><title>Signed in</title><h1>Signed in with ChatGPT</h1><p>You can close this window and return to the terminal.</p><script>window.close()</script>'
const errorHtml = (detail: string): string =>
  `<!doctype html><title>Sign-in failed</title><h1>Sign-in failed</h1><p>${detail.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)}</p><p>You can close this window.</p>`

type BunServer = ReturnType<typeof Bun.serve>

type Pending = {
  state: string
  resolve: (callback: { code: string }) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface CodexLoopback {
  listen(): Promise<{ port: number; redirectUri: string }>
  waitForCallback(args: { state: string }): Promise<{ code: string }>
  close(): Promise<void>
}

export class CodexLoopbackServer implements CodexLoopback {
  private server: BunServer | undefined
  private pending: Pending | undefined
  private successPending = false
  private readonly timeoutMs: number

  constructor(args: { timeoutMs?: number } = {}) {
    this.timeoutMs = args.timeoutMs ?? CALLBACK_TIMEOUT_MS
  }

  async listen(): Promise<{ port: number; redirectUri: string }> {
    for (const port of PORTS) {
      const server = this.tryServe(port)
      if (server === undefined) continue

      this.server = server
      return { port, redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}` }
    }

    throw new Error(
      `Atlas could not listen for the sign-in redirect: ports ${PORTS.join(' and ')} on 127.0.0.1 are both in use. Close the program holding them (another codex login?) and try again.`,
    )
  }

  waitForCallback(args: { state: string }): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined
        this.stopSoon()
        reject(new Error('the sign-in did not complete within five minutes'))
      }, this.timeoutMs)
      timer.unref?.()
      this.pending = { state: args.state, resolve, reject, timer }
    })
  }

  async close(): Promise<void> {
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      pending.reject(new Error('the callback server closed'))
    }

    if (!this.successPending) return this.stop()

    setTimeout(() => void this.stop(), SUCCESS_PAGE_GRACE_MS).unref?.()
  }

  private tryServe(port: number): BunServer | undefined {
    try {
      return Bun.serve({ hostname: '127.0.0.1', port, fetch: (req) => this.handle(req.url) })
    } catch {
      return undefined
    }
  }

  private handle(url: string): Response {
    const parsed = new URL(url)
    if (parsed.pathname === SUCCESS_PATH) return this.successPage()
    if (parsed.pathname !== CALLBACK_PATH) return new Response(null, { status: 404 })

    return this.callback(parsed)
  }

  private callback(url: URL): Response {
    const pending = this.pending
    if (pending === undefined)
      return this.errorPage('There is no sign-in in progress. Please try again.')

    this.pending = undefined
    clearTimeout(pending.timer)

    const failure = this.failureOf({ url, state: pending.state })
    if (failure !== undefined) {
      pending.reject(new Error(failure))
      return this.errorPage(failure)
    }

    this.successPending = true
    pending.resolve({ code: url.searchParams.get('code') ?? '' })

    return Response.redirect(`${url.origin}${SUCCESS_PATH}`, 302)
  }

  private failureOf(args: { url: URL; state: string }): string | undefined {
    const params = args.url.searchParams
    if (params.get('state') !== args.state) return 'the sign-in state did not match'

    const error = params.get('error')
    if (error !== null)
      return `the authorization server refused the sign-in: ${params.get('error_description') ?? error}`

    const code = params.get('code')
    if (code === null || code.length === 0) return 'no authorization code was returned'

    return undefined
  }

  private successPage(): Response {
    this.successPending = false
    this.stopSoon()

    return new Response(SUCCESS_HTML, { headers: HTML_TYPE })
  }

  private errorPage(detail: string): Response {
    this.stopSoon()

    return new Response(errorHtml(detail), { status: 400, headers: HTML_TYPE })
  }

  private stopSoon(): void {
    setTimeout(() => void this.stop(), 0).unref?.()
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server !== undefined) await server.stop(true)
  }
}
