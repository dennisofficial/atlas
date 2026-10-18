import { describe, expect, it } from 'bun:test'
import type { Sandbox } from '@vercel/sandbox'

import {
  DRAIN_COMMAND_TIMEOUT_MS,
  DRAIN_REASON,
  DRAIN_SEAL_DEADLINE_MS,
  DRAIN_SEAL_POLL_MS,
  drainServe,
} from '../serve-drain-client'
import { ERuntimePhase, SERVE_TOKEN_PATH } from '@dltech/atlas-wire'
import { rotationReceipt } from './rotation-fixture'
import { SANDBOX_HOME_PATH } from '@dltech/atlas-wire'
import { RUNTIME_CHECKPOINT_RELATIVE_PATH } from '../runtime-checkpoint'

const receipt = rotationReceipt()
const reply = JSON.stringify({ ok: true, prepared: true, receipt })

const RECORD_PATH = `${SANDBOX_HOME_PATH}/${RUNTIME_CHECKPOINT_RELATIVE_PATH}`

const SHRUNK_BUDGET = { deadlineMs: 60, pollMs: 5 }

const recordOf = (payload: string): string =>
  JSON.stringify({
    ...JSON.parse(JSON.stringify(receipt.checkpoint)),
    phase: ERuntimePhase.Updating,
    receipt: JSON.parse(payload),
  })

const sandboxAnswering = (args: {
  stdout: string
  persisted?: string
  afterRequest?: string
  exitCode?: number
  sealedAfterProbes?: number
  calls?: { script: string; timeoutMs: number }[]
}) => {
  let requested = false
  let probesSinceRequest = 0
  const sealed = (): boolean => {
    if (!requested) return false
    probesSinceRequest += 1
    return probesSinceRequest > (args.sealedAfterProbes ?? 0)
  }
  return {
    currentSession: () => ({ sessionId: 'session-1' }),
    runCommand: async (params: { args?: string[]; timeoutMs?: number }) => {
      const script = params.args?.[1] ?? ''
      args.calls?.push({ script, timeoutMs: params.timeoutMs ?? 0 })
      if (script.includes('/v1/drain')) {
        requested = true
        return { exitCode: args.exitCode ?? 0, stdout: async () => args.stdout }
      }
      const record = sealed() ? args.afterRequest ?? args.persisted ?? '' : args.persisted ?? ''
      return { exitCode: 0, stdout: async () => record }
    },
  } as unknown as Sandbox
}
const URL = 'https://sb-3000.vercel.run'

describe('confirmed drainServe', () => {
  it('POSTs the drain with the reason and requires a full receipt reply and a durable record', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await drainServe({ sandbox: sandboxAnswering({ stdout: `${reply}\n200`, afterRequest: recordOf(JSON.stringify(receipt)), calls }), url: URL })
    const call = calls.find((entry) => entry.script.includes('/v1/drain'))
    expect(call?.script).toContain(SERVE_TOKEN_PATH)
    expect(call?.script).toContain(`${URL}/v1/drain`)
    expect(call?.script).toContain(JSON.stringify({ reason: DRAIN_REASON }))
    expect(call?.timeoutMs).toBe(DRAIN_COMMAND_TIMEOUT_MS)
  })

  it('does not trust the old endpoint returning bare HTTP 200', async () => {
    for (const stdout of ['200', '{"ok":true,"paused":true}\n200', 'not-json\n200']) {
      await expect(drainServe({ sandbox: sandboxAnswering({ stdout }), url: URL })).rejects.toThrow()
    }
  })

  it('rejects a definitive refusal at once, without waiting for a seal', async () => {
    for (const stdout of ['401', '404', '503']) {
      const calls: { script: string; timeoutMs: number }[] = []
      await expect(drainServe({ sandbox: sandboxAnswering({ stdout, calls }), url: URL })).rejects.toThrow(`HTTP ${stdout}`)
      expect(calls).toHaveLength(3)
    }
  })

  it('waits twelve minutes for the seal after an unanswered request, polling every five seconds', () => {
    expect(DRAIN_SEAL_DEADLINE_MS).toBe(12 * 60 * 1000)
    expect(DRAIN_SEAL_POLL_MS).toBe(5_000)
  })

  it('resolves when the receipt lands on a later poll after the request timed out', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    const sandbox = sandboxAnswering({
      stdout: '000',
      exitCode: 28,
      afterRequest: recordOf(JSON.stringify(receipt)),
      sealedAfterProbes: 3,
      calls,
    })
    await drainServe({ sandbox, url: URL, sealBudget: { deadlineMs: 5_000, pollMs: 1 } })
    expect(calls.filter((call) => call.script.includes('/v1/drain'))).toHaveLength(1)
    expect(calls.filter((call) => call.script.includes(RECORD_PATH)).length).toBeGreaterThanOrEqual(5)
  })

  it('rejects after the deadline when an unanswered request never seals', async () => {
    for (const run of [{ stdout: '000', exitCode: 28 }, { stdout: '', exitCode: 0 }, { stdout: '000', exitCode: 0 }]) {
      const calls: { script: string; timeoutMs: number }[] = []
      const startedAt = Date.now()
      await expect(
        drainServe({ sandbox: sandboxAnswering({ ...run, calls }), url: URL, sealBudget: SHRUNK_BUDGET }),
      ).rejects.toThrow('nothing was destroyed')
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SHRUNK_BUDGET.deadlineMs - 5)
      expect(calls.filter((call) => call.script.includes('/v1/drain'))).toHaveLength(1)
    }
  })

  it('keeps waiting through a sandbox command that throws mid-request', async () => {
    let requested = false
    const sandbox = {
      currentSession: () => ({ sessionId: 'session-1' }),
      runCommand: async (params: { args?: string[] }) => {
        const script = params.args?.[1] ?? ''
        if (script.includes('/v1/drain')) {
          requested = true
          throw new Error('command timed out')
        }
        return { exitCode: 0, stdout: async () => (requested ? recordOf(JSON.stringify(receipt)) : '') }
      },
    } as unknown as Sandbox
    await drainServe({ sandbox, url: URL, sealBudget: SHRUNK_BUDGET })
  })

  it('lets a later wake recover a box an earlier client abandoned mid-drain: one probe, no request', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await drainServe({ sandbox: sandboxAnswering({ stdout: '000', exitCode: 28, persisted: recordOf(JSON.stringify(receipt)), calls }), url: URL })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.script).toContain(RECORD_PATH)
  })

  it('rejects a success reply with no persisted receipt', async () => {
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout: `${reply}\n200` }), url: URL })).rejects.toThrow('without durable preparation')
  })

  it('recovers a lost reply from the lifecycle record without requesting another drain', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await drainServe({ sandbox: sandboxAnswering({ stdout: '', persisted: recordOf(JSON.stringify(receipt)), calls }), url: URL })
    expect(calls.some((call) => call.script.includes('/v1/drain'))).toBe(false)
  })

  it('allows preparation that completed after the HTTP client timed out', async () => {
    await drainServe({ sandbox: sandboxAnswering({ stdout: '000', exitCode: 28, afterRequest: recordOf(JSON.stringify(receipt)) }), url: URL })
  })

  it('ignores receipts from another sandbox generation and rejects stale replies', async () => {
    const stale = { ...receipt, sandboxSessionId: 'old', checkpoint: { ...receipt.checkpoint, sandboxSessionId: 'old' } }
    const stdout = `${JSON.stringify({ ok: true, prepared: true, receipt: stale })}\n200`
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout, persisted: recordOf(JSON.stringify(stale)) }), url: URL })).rejects.toThrow('another sandbox session')
  })
})
