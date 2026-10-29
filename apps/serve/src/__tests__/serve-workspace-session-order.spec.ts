import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { createServeWorkspaceSession } from '../serve-workspace-session'

describe('serve boot ordering', () => {
  it('settles lost processes, then resumes declared services, then adopts children', async () => {
    const order: string[] = []
    const app = {
      log: { append: async () => [], readOwn: async () => [] },
      ids: { nextRunId: () => 'r' },
      recordLostShells: async () => {
        order.push('lost-shells')
        await Bun.sleep(20)
        return []
      },
      recordLostServices: async () => {
        order.push('lost-services')
        return []
      },
      recordLostAgents: undefined,
      resumeDeclaredServices: async () => {
        order.push('resume-services')
        await Bun.sleep(20)
      },
      adoptChildren: async () => {
        order.push('adopt')
        return []
      },
      whenChildrenSettled: async () => undefined,
    }
    const session = createServeWorkspaceSession({
      threadId: toThreadId('t'),
      app: app as never,
      log: () => undefined,
      settling: { count: 0 },
      note: () => undefined,
    })

    await session.whenStarted()

    expect(order.slice(-2)).toEqual(['resume-services', 'adopt'])
    expect(order.indexOf('resume-services')).toBeGreaterThan(order.indexOf('lost-services'))
    expect(order.indexOf('resume-services')).toBeGreaterThan(order.indexOf('lost-shells'))
  })

  it('does not let a failed resume block adoption', async () => {
    const order: string[] = []
    const app = {
      log: { append: async () => [], readOwn: async () => [] },
      ids: { nextRunId: () => 'r' },
      resumeDeclaredServices: async () => {
        throw new Error('boom')
      },
      adoptChildren: async () => {
        order.push('adopt')
        return []
      },
      whenChildrenSettled: async () => undefined,
    }
    const session = createServeWorkspaceSession({
      threadId: toThreadId('t'),
      app: app as never,
      log: () => undefined,
      settling: { count: 0 },
      note: () => undefined,
    })
    await session.whenStarted()
    expect(order).toEqual(['adopt'])
  })
})
