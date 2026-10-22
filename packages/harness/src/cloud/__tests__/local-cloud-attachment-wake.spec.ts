import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'

import type { CloudSandboxes } from '../cloud-bridge'
import { attachmentOf, type AttachOptions } from '../local-cloud-attachment'

const THREAD = toThreadId('thread-wake')
const PARENT = toThreadId('thread-wake-parent')

const wakeThrough = async (args: {
  projectIdOf?: AttachOptions['projectIdOf']
  sandboxThreadId?: typeof THREAD
}) => {
  const created: Array<{ threadId: string; projectId: string | null }> = []
  const sandboxes = {
    create: async (create: { threadId: string; projectId: string | null }) => {
      created.push({ threadId: create.threadId, projectId: create.projectId })
      throw new Error('stop after recording the wake')
    },
  } as unknown as CloudSandboxes
  const attachment = attachmentOf({
    options: { sessionMirror: false, projectIdOf: args.projectIdOf },
    sandboxes,
  })({
    threadId: THREAD,
    ...(args.sandboxThreadId === undefined ? {} : { sandboxThreadId: args.sandboxThreadId }),
  })
  attachment.channel.reconnect?.()
  await Bun.sleep(20)
  attachment.channel.close?.()
  return created
}

describe('attachmentOf channel-driven wake', () => {
  it('creates the sandbox with the project the hosted thread is recorded under', async () => {
    const asked: string[] = []

    const created = await wakeThrough({
      projectIdOf: async ({ threadId }) => {
        asked.push(threadId)
        return 'proj-1'
      },
    })

    expect(asked).toEqual([THREAD])
    expect(created).toEqual([{ threadId: THREAD, projectId: 'proj-1' }])
  })

  it('resolves the project of the sandbox-hosting thread when a successor attaches', async () => {
    const created = await wakeThrough({
      sandboxThreadId: PARENT,
      projectIdOf: async ({ threadId }) => (threadId === PARENT ? 'proj-parent' : null),
    })

    expect(created).toEqual([{ threadId: PARENT, projectId: 'proj-parent' }])
  })

  it('wakes with no project when none is recorded, lookup fails, or no lookup is wired', async () => {
    const none = await wakeThrough({ projectIdOf: async () => null })
    const failing = await wakeThrough({
      projectIdOf: () => Promise.reject(new Error('store down')),
    })
    const unwired = await wakeThrough({})

    expect(none).toEqual([{ threadId: THREAD, projectId: null }])
    expect(failing).toEqual([{ threadId: THREAD, projectId: null }])
    expect(unwired).toEqual([{ threadId: THREAD, projectId: null }])
  })
})
