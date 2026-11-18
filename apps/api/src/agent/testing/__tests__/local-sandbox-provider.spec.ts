import { afterEach, describe, expect, it } from 'bun:test'

import { LocalSandboxProvider } from '../local-sandbox-provider'

const CREDENTIALS = { token: '', teamId: '', projectId: '' }

describe('LocalSandboxProvider', () => {
  const provider = new LocalSandboxProvider({ daemonSecret: 'local-secret' })

  afterEach(async () => {
    await provider.stopAll()
  })

  it('wakes and answers a hello with the endpoint token', async () => {
    const endpoint = await provider.wake({
      sandboxSessionId: 's-local',
      credentials: CREDENTIALS,
      signal: AbortSignal.timeout(10_000),
    })
    const socket = new WebSocket(endpoint.url)
    try {
      const helloReply = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('no hello-reply')), 10_000)
        socket.addEventListener('open', () => {
          socket.send(
            JSON.stringify({
              kind: 'hello',
              sessionId: 's-local',
              epoch: 1,
              token: endpoint.token,
            }),
          )
        })
        socket.addEventListener('message', (event) => {
          const frame = JSON.parse(String(event.data)) as Record<string, unknown>
          if (frame.kind === 'hello-reply' || frame.kind === 'error') {
            clearTimeout(deadline)
            resolve(frame)
          }
        })
        socket.addEventListener('error', () => reject(new Error('websocket failed')), {
          once: true,
        })
      })
      expect(helloReply.kind).toBe('hello-reply')
    } finally {
      socket.close()
      await provider.stop({ sandboxSessionId: 's-local', credentials: CREDENTIALS })
    }
  })
})
