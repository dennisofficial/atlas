import { describe, expect, it } from 'bun:test'
import type { Sandbox } from '@vercel/sandbox'

import { DRAIN_COMMAND_TIMEOUT_MS, DRAIN_REASON, drainServe } from '../serve-drain-client'
import { SERVE_TOKEN_PATH } from '../serve-launch'
import { rotationReceipt } from './rotation-fixture'

const receipt = rotationReceipt()
const reply = JSON.stringify({ ok: true, prepared: true, receipt })
const sandboxAnswering = (args: {
  stdout: string
  persisted?: string
  afterRequest?: string
  exitCode?: number
  legacy?: boolean
  calls?: { script: string; timeoutMs: number }[]
}) => {
  let requested = false
  return {
    currentSession: () => ({ sessionId: 'session-1' }),
    runCommand: async (params: { args?: string[]; timeoutMs?: number }) => {
      const script = params.args?.[1] ?? ''
      args.calls?.push({ script, timeoutMs: params.timeoutMs ?? 0 })
      if (script.includes('/v1/health')) {
        return { exitCode: 0, stdout: async () => args.legacy ? '{"ok":true}' : '{"rotationPreparationVersion":1,"sandboxSessionId":"session-1"}' }
      }
      if (script.includes('/v1/drain')) {
        requested = true
        return { exitCode: args.exitCode ?? 0, stdout: async () => args.stdout }
      }
      return { exitCode: 0, stdout: async () => requested ? args.afterRequest ?? args.persisted ?? '' : args.persisted ?? '' }
    },
  } as unknown as Sandbox
}
const URL = 'https://sb-3000.vercel.run'

describe('confirmed drainServe', () => {
  it('requires both a full preparation reply and a durable receipt', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await drainServe({ sandbox: sandboxAnswering({ stdout: `${reply}\n200`, afterRequest: JSON.stringify(receipt), calls }), url: URL })
    const call = calls.find((entry) => entry.script.includes('/v1/drain'))
    expect(call?.script).toContain(SERVE_TOKEN_PATH)
    expect(call?.script).toContain(`${URL}/v1/drain`)
    expect(call?.script).toContain(JSON.stringify({ reason: DRAIN_REASON, preparationVersion: 1 }))
    expect(call?.timeoutMs).toBe(DRAIN_COMMAND_TIMEOUT_MS)
  })

  it('does not invoke the old unsafe endpoint without the safe-preparation capability', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout: '200', legacy: true, calls }), url: URL })).rejects.toThrow('sandbox was preserved')
    expect(calls.some((call) => call.script.includes('/v1/drain'))).toBe(false)
  })

  it('does not trust the old endpoint returning bare HTTP 200', async () => {
    for (const stdout of ['200', '{"ok":true,"paused":true}\n200', 'not-json\n200']) {
      await expect(drainServe({ sandbox: sandboxAnswering({ stdout }), url: URL })).rejects.toThrow()
    }
  })

  it('rejects 401, 404, timeouts and missing responses without preparation', async () => {
    for (const stdout of ['401', '404', '', '000']) {
      await expect(drainServe({ sandbox: sandboxAnswering({ stdout }), url: URL })).rejects.toThrow('nothing was destroyed')
    }
  })

  it('rejects a success reply with no persisted preparation', async () => {
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout: `${reply}\n200` }), url: URL })).rejects.toThrow('without durable preparation')
  })

  it('recovers a lost reply from the drive receipt without requesting another drain', async () => {
    const calls: { script: string; timeoutMs: number }[] = []
    await drainServe({ sandbox: sandboxAnswering({ stdout: '', persisted: JSON.stringify(receipt), calls }), url: URL })
    expect(calls.some((call) => call.script.includes('/v1/drain'))).toBe(false)
  })

  it('allows preparation that completed after the HTTP client timed out', async () => {
    await drainServe({ sandbox: sandboxAnswering({ stdout: '000', exitCode: 28, afterRequest: JSON.stringify(receipt) }), url: URL })
  })

  it('never accepts a preparing intent as completed preparation', async () => {
    const { checkpoint, ...intent } = receipt
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout: '404', persisted: JSON.stringify({ ...intent, preparing: true }) }), url: URL })).rejects.toThrow()
  })

  it('ignores receipts from another sandbox generation and rejects stale replies', async () => {
    const stale = { ...receipt, sandboxSessionId: 'old', checkpoint: { ...receipt.checkpoint, sandboxSessionId: 'old' } }
    const stdout = `${JSON.stringify({ ok: true, prepared: true, receipt: stale })}\n200`
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout, persisted: JSON.stringify(stale) }), url: URL })).rejects.toThrow('another sandbox session')
  })
})
