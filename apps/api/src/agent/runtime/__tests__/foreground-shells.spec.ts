import { describe, expect, it } from 'bun:test'
import { EKilledBy, toThreadId } from '@dltech/atlas-core'

import { ForegroundOnlyShells } from '../foreground-shells'

describe('ForegroundOnlyShells', () => {
  const shells = new ForegroundOnlyShells()
  const threadId = toThreadId('thread-1')

  it('refuses to start a background shell', async () => {
    const outcome = await shells.start({ threadId, command: 'echo hi', description: 'x' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('background shells are not available in this session yet')
    }
  })

  it('lists nothing and no-ops the rest', async () => {
    expect(shells.list({ threadId })).toEqual([])
    expect(shells.listEverywhere()).toEqual([])
    expect(shells.version()).toBe(0)
    expect(shells.peek({ shellId: 's', characters: 10, threadId })).toBeUndefined()
    expect(shells.read({ shellId: 's', threadId })).toEqual({
      ok: false,
      reason: 'background shells are not available in this session yet',
    })
    expect(shells.kill({ shellId: 's', by: EKilledBy.User, threadId })).toEqual({
      ok: false,
      reason: 'background shells are not available in this session yet',
    })
    expect(await shells.awaitEndings({ threadId, ms: 1 })).toBe(0)
    expect(shells.drainNotifications({ threadId })).toEqual([])
    expect(shells.pendingNotices({ threadId })).toEqual([])
    expect(shells.threadsAwaitingNotice()).toEqual([])
    expect(shells.subscribe()).toBeFunction()
    expect(shells.onNotice()).toBeFunction()
    shells.removeShells({ threadId, shellIds: ['s'], by: EKilledBy.User })
    shells.forgetNotices({ threadId })
    shells.reassignNotices({ from: threadId, to: threadId })
    await shells.closeAll()
  })
})
