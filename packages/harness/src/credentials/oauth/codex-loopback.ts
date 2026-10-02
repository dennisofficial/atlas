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

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

const PAGE_STYLE = `
  * { margin: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #3d2318 0%, #1f130d 55%, #120b08 100%);
    color: #e8f0ec; padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%; text-align: center; padding: 48px 40px;
    background: linear-gradient(165deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
    border: 1px solid rgba(255,255,255,0.09); border-radius: 20px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
  }
  .mark {
    width: 56px; height: 56px; margin: 0 auto 24px; border-radius: 16px;
    display: flex; align-items: center; justify-content: center; font-size: 28px; color: #fff;
    background: linear-gradient(140deg, #10a37f 0%, #0d8a6a 100%);
    box-shadow: 0 8px 24px rgba(16,163,127,0.35);
  }
  .mark.fail { background: linear-gradient(140deg, #b3402e 0%, #8f3123 100%); box-shadow: 0 8px 24px rgba(179,64,46,0.3); }
  h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.01em; margin-bottom: 10px; }
  p { font-size: 14px; line-height: 1.6; color: #9db3aa; }
  p.detail { color: #c9a79e; margin: 0 0 12px; font-size: 13px; }
`

const page = (args: { title: string; heading: string; body: string; failed: boolean }): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${args.title}</title><style>${PAGE_STYLE}</style></head><body><div class="card"><div class="mark${args.failed ? ' fail' : ''}">${args.failed ? '&#10007;' : '&#10003;'}</div><h1>${args.heading}</h1>${args.body}</div>${args.failed ? '' : '<script>window.close()</script>'}</body></html>`

const SUCCESS_HTML = page({
  title: 'Signed in',
  heading: 'Signed in with ChatGPT',
  body: '<p>You can close this window and return to the terminal.</p>',
  failed: false,
})

const errorHtml = (detail: string): string =>
  page({
    title: 'Sign-in failed',
    heading: 'Sign-in failed',
    body: `<p class="detail">${escapeHtml(detail)}</p><p>You can close this window and try again from the terminal.</p>`,
    failed: true,
  })

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
