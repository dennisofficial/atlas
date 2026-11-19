import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { REDIS_URL, waitAnswers } from './settle-fault-support'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const TTL_MS = 1_500
const BEAT_MS = 400
const POLL_MS = 100

const heldBy = async (args: { rig: FaultRig; sessionId: string }): Promise<string | undefined> => {
  const current = await args.rig.plane.currentLease({ sessionId: args.sessionId })
  if (!current.live || current.lease.holderHostId === null) return undefined
  return args.rig.labelOf(current.lease.holderHostId)
}

const waitHeldBy = async (args: {
  rig: FaultRig
  sessionId: string
  label: string
  timeoutMs: number
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    if ((await heldBy(args)) === args.label) return
    await Bun.sleep(POLL_MS)
  }
  throw new Error(
    `${args.sessionId} never reached ${args.label}: ${(await heldBy(args)) ?? 'no live holder'}`,
  )
}

const holdFor = async (args: {
  rig: FaultRig
  sessionId: string
  label: string
  ms: number
  timeoutMs: number
}): Promise<void> => {
  await waitHeldBy({ ...args, timeoutMs: args.timeoutMs })
  const deadline = Date.now() + args.ms
  while (Date.now() < deadline) {
    const holder = await heldBy(args)
    if (holder !== args.label) throw new Error(`${args.sessionId} left ${args.label} for ${holder}`)
    await Bun.sleep(POLL_MS)
  }
}

const holdAnyFor = async (args: {
  rig: FaultRig
  sessionId: string
  ms: number
  timeoutMs: number
}): Promise<string> => {
  const deadline = Date.now() + args.timeoutMs
  let holder = await heldBy(args)
  while (holder === undefined && Date.now() < deadline) {
    await Bun.sleep(POLL_MS)
    holder = await heldBy(args)
  }
  if (holder === undefined) throw new Error(`${args.sessionId} was not held again in time`)
  const until = Date.now() + args.ms
  while (Date.now() < until) {
    await Bun.sleep(POLL_MS)
    if ((await heldBy(args)) === undefined) throw new Error(`${args.sessionId} was released`)
  }
  return holder
}

const waitReleased = async (args: {
  rig: FaultRig
  sessionId: string
  timeoutMs: number
}): Promise<void> => {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    if ((await heldBy(args)) === undefined) return
    await Bun.sleep(POLL_MS)
  }
  throw new Error(`${args.sessionId} stayed held ${args.timeoutMs}ms after the beats stopped`)
}

describe.skipIf(REDIS_URL === undefined)(
  'F47 a panel hold follows the session across hosts',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('holds the pod across idle, drain, a kill and a pod restart, then releases one TTL after the beats stop', async () => {
      const sessionId = `fault-f47-${RUN}`
      const threadId = await rig.newSession({ sessionId, text: 'first' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const beats = rig.panelBeats({ sessionId, ttlMs: TTL_MS, everyMs: BEAT_MS })
      const knobs = { sweepMs: 500 }
      try {
        const hostA = await rig.spawnHost({
          label: 'host-a',
          daemonUrl: daemon.url,
          knobs,
          scripts: { [sessionId]: [{ text: 'first answer' }] },
        })
        await waitAnswers({ rig, threadId, count: 1, host: hostA, timeoutMs: 30_000 })
        await holdFor({
          rig,
          sessionId,
          label: 'host-a',
          ms: TTL_MS * 2 + 1_000,
          timeoutMs: 15_000,
        })

        const hostB = await rig.spawnHost({
          label: 'host-b',
          daemonUrl: daemon.url,
          knobs,
          scripts: {},
        })
        hostA.kill('SIGTERM')
        await hostA.exited
        await waitHeldBy({ rig, sessionId, label: 'host-b', timeoutMs: 30_000 })
        await Bun.sleep(TTL_MS * 2)
        await holdFor({ rig, sessionId, label: 'host-b', ms: TTL_MS + 1_000, timeoutMs: 15_000 })

        await rig.spawnHost({
          label: 'host-c',
          daemonUrl: daemon.url,
          knobs,
          scripts: {},
        })
        hostB.kill('SIGKILL')
        await hostB.exited
        await waitHeldBy({ rig, sessionId, label: 'host-c', timeoutMs: 30_000 })
        await Bun.sleep(TTL_MS * 2)
        await holdFor({ rig, sessionId, label: 'host-c', ms: TTL_MS + 1_000, timeoutMs: 15_000 })

        await daemon.restart({ keepHome: true })
        await holdAnyFor({
          rig,
          sessionId,
          ms: TTL_MS + 1_000,
          timeoutMs: 30_000,
        })

        await beats.stop()
        await waitReleased({ rig, sessionId, timeoutMs: TTL_MS + 8_000 })
        expect(heldBy({ rig, sessionId })).resolves.toBeUndefined()
      } finally {
        await beats.stop()
      }
    }, 180_000)
  },
)
