import { describe, expect, it } from 'bun:test'

import type { SandboxClient } from '../../cloud/sandbox-client'
import { ServeProcessPort } from '../serve-process'

const clientWith = (exposePort: SandboxClient['exposePort']): SandboxClient =>
  ({ exposePort }) as unknown as SandboxClient

describe('ServeProcessPort', () => {
  it('answers an exposure with the control-plane url rather than a sandbox-local one', async () => {
    const seen: { threadId: string; port: number }[] = []
    const port = new ServeProcessPort({
      threadId: 'brn_root',
      client: clientWith(async (args) => {
        seen.push(args)
        return 'https://sb-unguessable.vercel.run'
      }),
    })

    const outcome = await port.exposePort({ containerPort: 3001 })

    expect(seen).toEqual([{ threadId: 'brn_root', port: 3001 }])
    expect(outcome).toEqual({
      ok: true,
      exposure: {
        containerPort: 3001,
        hostPort: 3001,
        url: 'https://sb-unguessable.vercel.run',
      },
    })
  })

  it('reads a control-plane refusal as a reason, never as a localhost url', async () => {
    const port = new ServeProcessPort({
      threadId: 'brn_root',
      client: clientWith(async () => {
        throw new Error('The Atlas Cloud API answered POST /v1/sandboxes/brn_root/expose with 400: at most 15 ports.')
      }),
    })

    const outcome = await port.exposePort({ containerPort: 3001 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('at most 15 ports')
    expect(outcome.reason).not.toContain('localhost')
  })

  it('keeps the local spawn and which behaviour of the sandbox it runs in', () => {
    const port = new ServeProcessPort({
      threadId: 'brn_root',
      client: clientWith(async () => 'https://sb-x.vercel.run'),
    })

    expect(port.which({ command: 'sh' })).toBeString()
  })
})
