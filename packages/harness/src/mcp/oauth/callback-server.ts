// RFC 8252 §7.3: a native app's redirect URI is a loopback address with an ephemeral port; the
// authorization server matches the path, not the port. One shared server correlates concurrent
// flows by the OAuth `state` param, and shuts itself down once the last flow settles. Built on
// Bun.serve so the listener never holds the process open once it stops.

const CALLBACK_PATH = '/callback'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

type Pending = {
  resolve: (code: string) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const HTML_TYPE = { 'content-type': 'text/html' }
const SUCCESS_HTML =
  '<!doctype html><title>Signed in</title><h1>Signed in to the MCP server</h1><p>You can close this window and return to Atlas.</p><script>window.close()</script>'
const ERROR_HTML = (detail: string): string =>
  `<!doctype html><title>Sign-in failed</title><h1>Sign-in failed</h1><p>${detail}</p><p>You can close this window.</p>`

type BunServer = ReturnType<typeof Bun.serve>

export class OAuthCallbackServer {
  private server: BunServer | undefined
  private readonly pending = new Map<string, Pending>()

  /** Starts the loopback listener on an ephemeral port if it is not already running. */
  ensureRunning(): Promise<number> {
    if (this.server !== undefined) return Promise.resolve(this.port())

    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) => this.handle(req.url),
    })
    return Promise.resolve(this.port())
  }

  redirectUri(port: number): string {
    return `http://127.0.0.1:${port}${CALLBACK_PATH}`
  }

  /** Resolves with the authorization code for `state`, or rejects on error/timeout. */
  waitForCallback(state: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(state)
        this.stopIfIdle()
        reject(new Error('the sign-in did not complete within five minutes'))
      }, CALLBACK_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(state, { resolve, reject, timer })
    })
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('the callback server closed'))
    }
    this.pending.clear()
    await this.stop()
  }

  private port(): number {
    const port = this.server?.port
    if (port === undefined) throw new Error('the callback server is not listening')
    return port
  }

  private handle(url: string): Response {
    const parsed = new URL(url)
    if (parsed.pathname !== CALLBACK_PATH) return new Response(null, { status: 404 })

    const state = parsed.searchParams.get('state')
    const code = parsed.searchParams.get('code')
    const error = parsed.searchParams.get('error')

    const pending = state === null ? undefined : this.pending.get(state)
    if (state === null || pending === undefined) {
      return new Response(ERROR_HTML('Invalid or expired sign-in state. Please try again.'), {
        status: 400,
        headers: HTML_TYPE,
      })
    }

    clearTimeout(pending.timer)
    this.pending.delete(state)

    let body: string
    if (error !== null || code === null) {
      const detail = parsed.searchParams.get('error_description') ?? error ?? 'no code was returned'
      pending.reject(new Error(`the authorization server refused the sign-in: ${detail}`))
      body = ERROR_HTML(detail)
    } else {
      pending.resolve(code)
      body = SUCCESS_HTML
    }

    const response = new Response(body, { status: 200, headers: HTML_TYPE })
    // Defer the shutdown until after this response has flushed, or stop(true) resets the socket.
    this.stopIfIdleDeferred()
    return response
  }

  private stopIfIdle(): void {
    if (this.pending.size > 0) return
    void this.stop()
  }

  private stopIfIdleDeferred(): void {
    if (this.pending.size > 0) return
    setTimeout(() => void this.stop(), 0).unref?.()
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server !== undefined) await server.stop(true)
  }
}
