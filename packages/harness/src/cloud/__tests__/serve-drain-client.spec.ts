import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import { DRAIN_COMMAND_TIMEOUT_MS, DRAIN_REASON, drainServe } from '../serve-drain-client'
import { SERVE_TOKEN_PATH } from '../serve-launch'

const sandboxAnswering = (args: { stdout: string; calls?: { script: string; timeoutMs: number }[] }) =>
  ({
    runCommand: async (params: { args?: string[]; timeoutMs?: number }) => {
      args.calls?.push({ script: params.args?.[1] ?? '', timeoutMs: params.timeoutMs ?? 0 })
      return { exitCode: 0, stdout: async () => args.stdout, stderr: async () => '' }
    },
  }) as unknown as Sandbox

const URL = 'https://sb-3000.vercel.run'

describe('drainServe', () => {
  it('posts the reason to /v1/drain with the staged serve token under a bounded command timeout', async () => {
    const calls: { script: string; timeoutMs: number }[] = []

    await drainServe({ sandbox: sandboxAnswering({ stdout: '200', calls }), url: URL })

    const call = calls[0]
    expect(call?.script).toContain(SERVE_TOKEN_PATH)
    expect(call?.script).toContain(`${URL}/v1/drain`)
    expect(call?.script).toContain('-X POST')
    expect(call?.script).toContain(JSON.stringify({ reason: DRAIN_REASON }))
    expect(call?.timeoutMs).toBe(DRAIN_COMMAND_TIMEOUT_MS)
  })

  it('rejects on a 404 from a serve that predates the endpoint', async () => {
    await expect(drainServe({ sandbox: sandboxAnswering({ stdout: '404' }), url: URL })).rejects.toThrow('HTTP 404')
  })

  it('rejects when nothing answers', async () => {
    for (const stdout of ['', '000']) {
      await expect(drainServe({ sandbox: sandboxAnswering({ stdout }), url: URL })).rejects.toThrow('did not answer')
    }
  })
})
