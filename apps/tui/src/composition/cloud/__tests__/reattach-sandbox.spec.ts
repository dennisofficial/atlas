import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes } from '@dltech/atlas-harness'
import { reattachSandbox } from '../reattach-sandbox'

const THREAD = toThreadId('brn_cloud')

const stubSandboxes = (args: { token?: string; createFails?: unknown }) => {
  const created: Parameters<CloudSandboxes['create']>[0][] = []
  const sandboxes: CloudSandboxes = {
    create: async (request) => {
      created.push(request)
      if (args.createFails !== undefined) throw args.createFails
      return {
        state: ECloudSandboxState.Running,
        url: 'https://atlas-3000.vercel.run',
        token: args.token ?? 'tok_fresh',
        created: false,
      }
    },
    putContext: async () => undefined,
    putTranscript: async () => undefined,
    find: async () => undefined,
    destroy: async () => undefined,
  }
  return { sandboxes, created }
}

describe('reattachSandbox', () => {
  it('re-claims and re-provisions without touching the stored workspace, handing back the fresh url and token', async () => {
    const { sandboxes, created } = stubSandboxes({ token: 'tok_fresh' })

    const attachment = await reattachSandbox({ sandboxes, threadId: THREAD })

    expect(created).toEqual([{ threadId: THREAD, workspace: null }])
    expect(attachment).toEqual({ url: 'https://atlas-3000.vercel.run', token: 'tok_fresh' })
  })

  it('propagates a provisioning failure, so the channel can say so', async () => {
    const { sandboxes } = stubSandboxes({ createFails: new Error('no capacity in iad1') })

    await expect(reattachSandbox({ sandboxes, threadId: THREAD })).rejects.toThrow(
      'no capacity in iad1',
    )
  })
})
