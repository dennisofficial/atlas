import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { createDirectWorkspace } from '../direct-workspace'
import { createServeWorkspaceSession } from '../serve-workspace-session'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('startup-owner')
const gate = () => {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
const noop = (): void => undefined

it('waits for startup adoption and recovery admissions, not the children’s entire turns', async () => {
  const adoption = gate()
  const recovery = gate()
  const fullTurn = gate()
  const app = {
    ...fakeServeApp({
      threadId, root: '/workspace',
      adoptChildren: async () => { await adoption.promise; return [toThreadId('child')] },
      whenChildrenSettled: () => fullTurn.promise,
    }),
    recordLostShells: async () => { await recovery.promise; return [] },
  }
  const session = createServeWorkspaceSession({
    direct: createDirectWorkspace({ driveHome: '/tmp/unused-startup-home', destination: '/workspace' }),
    driveHome: '/tmp/unused-startup-home', threadId, activeCwd: '/workspace', app,
    dormant: false, log: noop, settling: { count: 0 }, note: noop,
  })
  let initialized = false
  const settled = session.whenStarted().then(() => { initialized = true })
  await Promise.resolve()
  expect(initialized).toBe(false)
  adoption.release()
  await Promise.resolve()
  expect(initialized).toBe(false)
  recovery.release()
  await settled
  expect(initialized).toBe(true)
  fullTurn.release()
  await app.close()
})

it('does not authorize replacement if an initialization write failed', async () => {
  const app = {
    ...fakeServeApp({ threadId, root: '/workspace' }),
    recordLostShells: async (): Promise<never> => { throw new Error('ending persistence failed') },
  }
  const session = createServeWorkspaceSession({
    direct: createDirectWorkspace({ driveHome: '/tmp/unused-startup-home', destination: '/workspace' }),
    driveHome: '/tmp/unused-startup-home', threadId, activeCwd: '/workspace', app,
    dormant: false, log: noop, settling: { count: 0 }, note: noop,
  })
  await expect(session.whenStarted()).rejects.toThrow('ending persistence failed')
  await app.close()
})
