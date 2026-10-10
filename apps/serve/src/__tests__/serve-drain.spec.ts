import { describe, expect, it } from 'bun:test'
import { EKilledBy, toThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, type SandboxRotationReceipt } from '@dltech/atlas-wire'

import { createServeDrain } from '../serve-drain'

const threadId = toThreadId('drain-owner')
const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => { open = resolve })
  return { done, open }
}
const receipt = (resumeParent: boolean): SandboxRotationReceipt => ({
  version: 1, threadId, sandboxSessionId: 'session-1', resumeParent,
  checkpoint: {
    threadId, sandboxSessionId: 'session-1', runtimeId: 'runtime-1', revision: 1,
    phase: ERuntimePhase.Rotating, reportedAt: '2026-10-03T00:00:00Z',
    transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
  },
})
const fixture = (over: {
  resumeParent?: boolean
  pause?: () => Promise<void>
  endProcesses?: () => Promise<void>
  flushInput?: () => Promise<void>
  seal?: () => Promise<SandboxRotationReceipt>
} = {}) => {
  const calls: string[] = []
  const drain = createServeDrain({
    threadId,
    driver: {
      beginRelocation: over.pause ?? (async () => { calls.push('confirmed-pause') }),
      relocationResumable: () => over.resumeParent ?? false,
    },
    closeAdmission: () => { calls.push('close-admission') },
    reopenAdmission: () => { calls.push('reopen-admission') },
    beginPreparation: async () => { calls.push('intent') },
    endProcesses: over.endProcesses ?? (async ({ killedBy }) => { calls.push(`endings:${killedBy}`) }),
    flushInput: over.flushInput ?? (async () => { calls.push('input') }),
    seal: over.seal ?? (async ({ resumeParent }) => { calls.push('seal'); return receipt(resumeParent) }),
    retire: async ({ reason }) => { calls.push(`retire:${reason}`) },
    log: () => undefined,
    replyFlushMs: 1,
  })
  return { calls, drain }
}

describe('confirmed rotation preparation', () => {
  it('persists intent, confirms the shared family pause, flushes inputs, and seals before replying', async () => {
    const test = fixture({ resumeParent: true })
    expect(await test.drain({ reason: 'update' })).toEqual({ ok: true, prepared: true, receipt: receipt(true) })
    expect(test.calls).toEqual(['close-admission', 'intent', 'confirmed-pause', `endings:${EKilledBy.Rotation}`, 'input', 'seal'])
  })

  it('does not end processes or seal while a parent or child has not reached its seam', async () => {
    const held = gate()
    const test = fixture({ pause: () => held.done })
    const first = test.drain({ reason: 'update' })
    const second = test.drain({ reason: 'retry' })
    await Bun.sleep(20)
    expect(test.calls).toEqual(['close-admission', 'intent'])
    held.open()
    expect(await first).toEqual(await second)
    expect(test.calls.filter((call) => call === 'seal')).toHaveLength(1)
  })

  it('reopens admission after a failed family pause and never ends processes', async () => {
    const test = fixture({ pause: async () => { throw new Error('child failed to pause') } })
    await expect(test.drain({ reason: 'update' })).rejects.toThrow('child failed to pause')
    await Bun.sleep(10)
    expect(test.calls).toEqual(['close-admission', 'intent', 'reopen-admission'])
  })

  it('reopens admission after a process-stop failure without sealing or retiring', async () => {
    const test = fixture({ endProcesses: async () => { throw new Error('service is still running') } })
    await expect(test.drain({ reason: 'update' })).rejects.toThrow('service is still running')
    await Bun.sleep(10)
    expect(test.calls).not.toContain('seal')
    expect(test.calls.some((call) => call.startsWith('retire'))).toBe(false)
    expect(test.calls.at(-1)).toBe('reopen-admission')
  })

  it('reopens admission when queued input could not be saved', async () => {
    const test = fixture({ flushInput: async () => { throw new Error('append failed') } })
    await expect(test.drain({ reason: 'update' })).rejects.toThrow('append failed')
    expect(test.calls).not.toContain('seal')
    expect(test.calls).toContain('reopen-admission')
  })

  it('does not acknowledge or retire when persistence fails, and allows retry', async () => {
    let attempts = 0
    const test = fixture({ seal: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('disk unavailable')
      return receipt(false)
    } })
    await expect(test.drain({ reason: 'update' })).rejects.toThrow('disk unavailable')
    await Bun.sleep(10)
    expect(test.calls.some((call) => call.startsWith('retire'))).toBe(false)
    expect(test.calls).toContain('reopen-admission')
    expect(await test.drain({ reason: 'retry' })).toEqual({ ok: true, prepared: true, receipt: receipt(false) })
    await Bun.sleep(10)
    expect(test.calls.at(-1)).toBe('retire:retry')
    expect(test.calls.filter((call) => call === 'close-admission')).toHaveLength(2)
    expect(test.calls.filter((call) => call === 'reopen-admission')).toHaveLength(1)
  })

  it('retires only after the proof reply is ready', async () => {
    const test = fixture()
    await test.drain({ reason: 'update' })
    expect(test.calls).not.toContain('retire:update')
    await Bun.sleep(10)
    expect(test.calls.at(-1)).toBe('retire:update')
  })
})
