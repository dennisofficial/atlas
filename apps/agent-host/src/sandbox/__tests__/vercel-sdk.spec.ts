import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import { renewSessionDeadline } from '../vercel-sdk'

const NOW = 1_000_000

const fakeSandbox = (args: { status: string; expiresAt: number }) => {
  const extended: number[] = []
  const sandbox = {
    expiresAt: new Date(args.expiresAt),
    currentSession: () => ({
      sessionId: 'sbx_live123',
      status: args.status,
      extendTimeout: async (ms: number) => {
        extended.push(ms)
      },
    }),
  } as unknown as Sandbox
  return { sandbox, extended }
}

const renew = (sandbox: Sandbox, until: number) =>
  renewSessionDeadline({ sandbox, name: 'atlas-v2-abc', sessionId: 'abc', until })

describe('renewSessionDeadline', () => {
  it('extends the timeout although the Vercel session id differs from the Atlas session id', async () => {
    const { sandbox, extended } = fakeSandbox({ status: 'running', expiresAt: NOW })

    await renew(sandbox, NOW + 60_000)

    expect(extended).toEqual([60_000])
  })

  it('does not extend a deadline that is already far enough away', async () => {
    const { sandbox, extended } = fakeSandbox({ status: 'running', expiresAt: NOW + 120_000 })

    await renew(sandbox, NOW + 60_000)

    expect(extended).toEqual([])
  })

  it('refuses to renew a sandbox that is not running', async () => {
    const { sandbox, extended } = fakeSandbox({ status: 'stopped', expiresAt: NOW })

    await expect(renew(sandbox, NOW + 60_000)).rejects.toThrow('is stopped')
    expect(extended).toEqual([])
  })
})
