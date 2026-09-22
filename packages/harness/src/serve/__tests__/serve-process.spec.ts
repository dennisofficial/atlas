import { describe, expect, it } from 'bun:test'

import type { VercelDriver } from '../../cloud/vercel-driver'
import { ServeProcessPort } from '../serve-process'

const driverWith = (exposePort: VercelDriver['exposePort']): Pick<VercelDriver, 'exposePort'> => ({
  exposePort,
})

describe('ServeProcessPort', () => {
  it('answers an exposure with the Vercel-routed url rather than a sandbox-local one', async () => {
    const seen: { name: string; port: number }[] = []
    const port = new ServeProcessPort({
      name: 'atlas-thread-deadbeef',
      driver: driverWith(async (args) => {
        seen.push(args)
        return 'https://sb-unguessable.vercel.run'
      }),
    })

    const outcome = await port.exposePort({ containerPort: 3001 })

    expect(seen).toEqual([{ name: 'atlas-thread-deadbeef', port: 3001 }])
    expect(outcome).toEqual({
      ok: true,
      exposure: {
        containerPort: 3001,
        hostPort: 3001,
        url: 'https://sb-unguessable.vercel.run',
      },
    })
  })

  it('reads a Vercel refusal as a reason, never as a localhost url', async () => {
    const port = new ServeProcessPort({
      name: 'atlas-thread-deadbeef',
      driver: driverWith(async () => {
        throw new Error('a sandbox exposes at most 15 ports and this one is at the limit')
      }),
    })

    const outcome = await port.exposePort({ containerPort: 3001 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('at most 15 ports')
    expect(outcome.reason).not.toContain('localhost')
  })

  it('refuses with a teaching reason when the sandbox carries no Vercel credentials', async () => {
    const port = new ServeProcessPort(null)

    const outcome = await port.exposePort({ containerPort: 3001 })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('no Vercel credentials')
    expect(outcome.reason).not.toContain('localhost')
  })

  it('keeps the local spawn and which behaviour of the sandbox it runs in', () => {
    const port = new ServeProcessPort(null)

    expect(port.which({ command: 'sh' })).toBeString()
  })
})
