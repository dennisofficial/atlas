import { LoopbackServer, type Loopback } from './loopback-server'

// Loopback listener for the Claude browser sign-in, as Claude Code 2.1.287 runs it: the
// authorize request names http://localhost:<port>/callback and the server binds 127.0.0.1 on the
// first free candidate port. Verified end-to-end against a real account (spike, 2026-10-02):
// Anthropic's authorization server accepts the localhost redirect for this client, the code
// exchanges, and the refresh token rotates on refresh.
export const ANTHROPIC_LOOPBACK_PORTS = [53692, 53693, 53694, 1455, 1457, 8085, 8976] as const

export class AnthropicLoopbackServer extends LoopbackServer {
  constructor(args: { timeoutMs?: number } = {}) {
    super({
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      spec: {
        ports: ANTHROPIC_LOOPBACK_PORTS,
        callbackPath: '/callback',
        redirectHost: 'localhost',
        successHeading: 'Signed in to Claude',
        brand: {
          accent: '#d97757',
          accentDark: '#b85c3f',
          accentShadow: 'rgba(217,119,87,0.35)',
        },
      },
    })
  }
}

export type AnthropicLoopback = Loopback
