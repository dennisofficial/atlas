import { LoopbackServer, type Loopback } from './loopback-server'

// Loopback listener for the ChatGPT browser sign-in, as `codex login` runs it (openai/codex
// codex-rs/login/src/server.rs): bind 127.0.0.1:1455, fall back to 1457, receive the redirect at
// /auth/callback.
export class CodexLoopbackServer extends LoopbackServer {
  constructor(args: { timeoutMs?: number } = {}) {
    super({
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      spec: {
        ports: [1455, 1457],
        callbackPath: '/auth/callback',
        redirectHost: '127.0.0.1',
        successHeading: 'Signed in with ChatGPT',
        brand: {
          accent: '#10a37f',
          accentDark: '#0d8a6a',
          accentShadow: 'rgba(16,163,127,0.35)',
        },
      },
    })
  }
}

export type CodexLoopback = Loopback
