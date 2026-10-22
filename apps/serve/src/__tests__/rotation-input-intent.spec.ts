import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import { bindServeDrain } from '../serve-drain-binding'
import { fakeServeApp } from './fakes'
import type { RotationResume } from '../runtime-checkpoint-binding'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

it('carries owed and pending continuation obligations into the seal, even when sealing fails', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-rotation-input-intent-'))
  homes.push(home)
  const threadId = toThreadId('parent')
  const childId = toThreadId('finished-child')
  const owedChild = toThreadId('owed-child')
  const app = fakeServeApp({ threadId, root: '/workspace', intake: true })
  app.intake?.suspend()
  app.pending?.forThread({ threadId }).enqueue({ text: 'continue parent' })
  app.pending?.forThread({ threadId: childId }).enqueue({ text: 'continue the finished child' })
  let retired = false
  let sealed: RuntimeCheckpoint | null = null
  let resume: RotationResume | undefined
  const drain = bindServeDrain({
    app,
    threadId,
    atlasHome: home,
    sandboxSessionId: 'source',
    owed: { parent: false, children: [owedChild] },
    driver: {
      beginRelocation: async () => undefined,
      relocationResumable: () => false,
      busy: () => false,
      say: async () => undefined,
      run: () => undefined,
      sayOrRun: () => false,
      interrupt: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      running: () => false,
      outcomePending: () => false,
      settled: async () => undefined,
      attach: () => () => undefined,
      holdHistory: () => () => undefined,
      beginRotation: () => ({ pause: () => undefined, waitSettled: async () => null }),
      holdForRotation: () => () => undefined,
    },
    haltIdle: () => undefined,
    whenMutationsSettled: async () => undefined,
    checkpoint: {
      current: () => sealed,
      finalizeRotation: async (given) => {
        resume = given.resume
        throw new Error('sealing interrupted')
      },
    },
    close: async () => {
      retired = true
    },
    exit: () => {
      retired = true
    },
    log: () => undefined,
  })
  try {
    await expect(drain({ reason: 'update' })).rejects.toThrow('sealing interrupted')
    expect(app.pending?.waitingCount()).toBe(0)
    expect(resume).toEqual({ parent: true, children: expect.arrayContaining([childId, owedChild]) })
    expect(sealed).toBeNull()
    expect(retired).toBe(false)
  } finally {
    await app.close()
  }
})
