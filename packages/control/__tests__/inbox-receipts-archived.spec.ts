import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'

const T0 = '2026-11-26T10:00:00.000Z'
const T1 = '2026-11-26T10:01:00.000Z'

const rig = async () => {
  const store = new InMemoryControlStore({ clock: () => T0 })
  const plane = new ControlPlane({ store, clock: () => T0 })
  await plane.createSession({
    sessionId: 'parent',
    mainThreadId: 'tp',
    userId: 'u1',
    projectId: null,
  })
  await plane.spawnPeer({ spawnerSessionId: 'parent', sessionId: 'child', mainThreadId: 'tc' })
  const archive = async (sessionId: string) =>
    await store.transact((tx) => tx.setSessionArchived({ sessionId, archivedAt: T1 }))
  return { plane, archive }
}

describe('a keyed post replayed after its destination was archived', () => {
  it('answers a delivered peer message with its first result', async () => {
    const { plane, archive } = await rig()
    const message = {
      fromSessionId: 'parent',
      toSessionId: 'child',
      text: 'the brief',
      clientId: 'call-message.0',
    }
    const first = await plane.messagePeer(message)
    await archive('child')
    expect(await plane.messagePeer(message)).toEqual(first)
  })

  it('answers a delivered report with its first result', async () => {
    const { plane, archive } = await rig()
    const report = { sessionId: 'child', text: 'the report', clientId: 'call-report.0' }
    const first = await plane.reportToSpawner(report)
    await archive('parent')
    expect(await plane.reportToSpawner(report)).toEqual(first)
  })

  it('still refuses a new keyed message to an archived session', async () => {
    const { plane, archive } = await rig()
    await archive('child')
    const sent = await plane.messagePeer({
      fromSessionId: 'parent',
      toSessionId: 'child',
      text: 'late',
      clientId: 'call-late.0',
    })
    expect('refused' in sent).toBe(true)
  })
})
