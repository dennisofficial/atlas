import type { VercelSdk } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { stopSessionForRollover } from './pod-rollover-stop'

const FAST = { pollMs: 1, graceMs: 20, forceMs: 20 }
const CREDENTIALS = { token: 't', teamId: 'team', projectId: 'prj' }

function sdkWith(args: { status: string; liveSession: string; stops: boolean }) {
  const calls: string[] = []
  let status = args.status
  const sandbox = {
    get status() {
      return status
    },
    currentSession: () => ({ sessionId: args.liveSession }),
    stop: async () => {
      calls.push('stop')
      if (args.stops) status = 'stopped'
    },
  }
  const sdk = { get: async () => sandbox } as unknown as VercelSdk
  return { sdk, calls }
}

const run = (args: { sdk: VercelSdk; log?: (line: string) => void }) =>
  stopSessionForRollover({
    sdk: args.sdk,
    credentials: CREDENTIALS,
    name: 'atlas-thread-1',
    sessionId: 'ses-old',
    log: args.log ?? (() => undefined),
    timing: FAST,
  })

describe('stopSessionForRollover', () => {
  it('stops the matching running session and waits for it to settle', async () => {
    const { sdk, calls } = sdkWith({ status: 'running', liveSession: 'ses-old', stops: true })
    await run({ sdk })
    expect(calls).toEqual(['stop'])
  })

  it('throws when the session does not settle in time', async () => {
    const { sdk } = sdkWith({ status: 'running', liveSession: 'ses-old', stops: false })
    await expect(run({ sdk })).rejects.toThrow('did not stop for the rollover')
  })

  it('never stops a different live session', async () => {
    const { sdk, calls } = sdkWith({ status: 'running', liveSession: 'ses-new', stops: true })
    const logs: string[] = []
    await run({ sdk, log: (line) => logs.push(line) })
    expect(calls).toEqual([])
    expect(logs[0]).toContain('ses-new')
  })

  it('returns when the sandbox is already stopped', async () => {
    const { sdk, calls } = sdkWith({ status: 'stopped', liveSession: 'ses-old', stops: true })
    await run({ sdk })
    expect(calls).toEqual([])
  })

  it('returns when the sandbox is missing', async () => {
    const sdk = {
      get: async () => {
        throw new Error("Sandbox 'atlas-thread-1' not found for this project")
      },
    } as unknown as VercelSdk
    await run({ sdk })
  })
})
