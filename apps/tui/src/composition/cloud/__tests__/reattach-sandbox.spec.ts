import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes } from '../cloud-bridge'
import { reattachSandbox } from '../reattach-sandbox'

const THREAD = toThreadId('brn_cloud')

const stubSandboxes = (args: {
  token?: string
  statuses: ({ state: ECloudSandboxState; url?: string } | undefined)[]
}) => {
  const created: Parameters<CloudSandboxes['create']>[0][] = []
  const sandboxes: CloudSandboxes = {
    create: async (request) => {
      created.push(request)
      return {
        state: ECloudSandboxState.Resuming,
        token: args.token ?? 'tok_fresh',
      }
    },
    putContext: async () => undefined,
    find: async () => args.statuses.shift(),
  }
  return { sandboxes, created }
}

describe('reattachSandbox', () => {
  it('re-creates the attachment without touching the stored workspace, then waits for the url', async () => {
    const { sandboxes, created } = stubSandboxes({
      token: 'tok_fresh',
      statuses: [
        { state: ECloudSandboxState.Resuming },
        { state: ECloudSandboxState.Running, url: 'https://atlas-3000.vercel.run' },
      ],
    })

    const attachment = await reattachSandbox({
      sandboxes,
      threadId: THREAD,
      sleep: async () => undefined,
    })

    expect(created).toEqual([{ threadId: THREAD, workspace: null }])
    expect(attachment).toEqual({ url: 'https://atlas-3000.vercel.run', token: 'tok_fresh' })
  })

  it('fails when the provision died server-side, so the channel can say so', async () => {
    const { sandboxes } = stubSandboxes({ statuses: [undefined] })

    await expect(
      reattachSandbox({ sandboxes, threadId: THREAD, sleep: async () => undefined }),
    ).rejects.toThrow('failed to start')
  })
})
