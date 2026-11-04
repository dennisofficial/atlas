import { describe, it } from 'bun:test'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('F9 Redis down for the whole session', () => {
  it.skip('wakes by reconcile and stops by inbox poll [gap: no wake path without redis — SessionHolder.start subscribes only to bus.onWake (packages/host/src/holder/session-holder.ts:68-72) and the reconcile task exists (packages/jobs/src/reconcile-holders.ts) but wakes holders only by publishing to redis (apps/trigger/src/reconcile/reconcile-holders.ts publishes to WAKE_CHANNEL), so with redis down no host ever claims the session]', () => {
    // A fixed product would: spawn two hosts with redisUrl pointing at a closed port,
    // post a message, and assert a claim within the reconcile window (60 s scaled),
    // then assert a stop inbox entry lands within one inbox poll.
  })
})
