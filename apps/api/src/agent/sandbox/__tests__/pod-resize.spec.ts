import { describe, expect, it } from 'bun:test'

import type { VercelConfig } from '../../config/agent-host-config'
import { podResizeHandler, type ResizeCredentialsSource } from '../pod-resize'
import type { SandboxProvider } from '../sandbox-provider'

const CREDENTIALS = { token: 'vercel-tok', teamId: 'team-1', projectId: 'proj-1' }

const configOf = (vercel: VercelConfig): ResizeCredentialsSource => ({
  read: async () => ({ vercel }),
})

const recordingSandbox = (failure?: Error) => {
  const calls: { sandboxSessionId: string; vcpus: number }[] = []
  const provider = {
    resize: async (args: { sandboxSessionId: string; vcpus: number }) => {
      calls.push({ sandboxSessionId: args.sandboxSessionId, vcpus: args.vcpus })
      if (failure !== undefined) throw failure
    },
  } as unknown as SandboxProvider
  return { provider, calls }
}

const run = async (args: {
  raw: unknown
  config: ResizeCredentialsSource
  sandbox: SandboxProvider
  podKey?: string
}) => {
  const refused: string[] = []
  const handler = podResizeHandler({
    sandbox: args.sandbox,
    config: args.config,
    podSessionIdOf: async () => args.podKey ?? 'ses-pod',
  })
  const result = await handler({
    args: args.raw,
    sessionId: 'ses-child',
    inboxId: 4,
    visibleEvents: () => [],
    append: async () => {
      refused.push('appended')
    },
    log: () => undefined,
  })
  return { result, appendCalls: refused }
}

describe('resize command handler', () => {
  it('resizes the pod the session belongs to and reports done', async () => {
    const { provider, calls } = recordingSandbox()
    const { result } = await run({
      raw: { vcpus: 8 },
      config: configOf({ configured: true, ...CREDENTIALS }),
      sandbox: provider,
      podKey: 'ses-parent',
    })
    expect(result).toEqual({ kind: 'done' })
    expect(calls).toEqual([{ sandboxSessionId: 'ses-parent', vcpus: 8 }])
  })

  it('refuses a size Vercel does not offer without touching the sandbox', async () => {
    const { provider, calls } = recordingSandbox()
    const { result } = await run({
      raw: { vcpus: 3 },
      config: configOf({ configured: true, ...CREDENTIALS }),
      sandbox: provider,
    })
    expect(result.kind).toBe('refused')
    expect(calls).toEqual([])
  })

  it('refuses when the owner has no usable Vercel credential', async () => {
    const { provider, calls } = recordingSandbox()
    const { result } = await run({
      raw: { vcpus: 4 },
      config: configOf({ configured: false, gap: 'user-credential' }),
      sandbox: provider,
    })
    expect(result).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('user-credential') as unknown as string,
    })
    expect(calls).toEqual([])
  })

  it('reports a Vercel failure as a refusal and stays replayable', async () => {
    const { provider, calls } = recordingSandbox(new Error('sandbox not found'))
    const config = configOf({ configured: true, ...CREDENTIALS })
    const first = await run({ raw: { vcpus: 4 }, config, sandbox: provider })
    expect(first.result).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('sandbox not found') as unknown as string,
    })
    const second = await run({ raw: { vcpus: 4 }, config, sandbox: provider })
    expect(second.result.kind).toBe('refused')
    expect(calls).toHaveLength(2)
  })
})
