import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { createDeltaChannel, ETurnStatus } from '@dltech/atlas-harness'
import { API_PROVISIONED_ENV, POD_NAME_ENV } from '@dltech/atlas-wire'

import { bindServeActivity, NOOP_SERVE_ACTIVITY } from '../serve-activity-binding'
import type { ActivityState } from '../serve-activity-reporter'
import { trpcOk, trpcUrl } from './trpc-fake'

const threadId = toThreadId('thr-1')

const app = () => ({
  log: { readOwn: async () => [], head: async () => 0 } as never,
  channel: createDeltaChannel(),
})

const remote = {
  controlPlaneUrl: 'http://api',
  token: 't',
  clientVersion: '0',
  fetchFn: fetch,
}

const disabledEnvironments: Record<string, string | undefined>[] = [
  {},
  { [API_PROVISIONED_ENV]: '0' },
  { [API_PROVISIONED_ENV]: '1', [POD_NAME_ENV]: 'local-pod' },
  { ATLAS_CLOUD_URL: 'http://api', ATLAS_SERVE_TOKEN: 't', [POD_NAME_ENV]: 'local-pod' },
]
const enabledEnvironments: Record<string, string | undefined>[] = [
  { [API_PROVISIONED_ENV]: '1' },
  { ATLAS_CLOUD_URL: 'http://api', ATLAS_SERVE_TOKEN: 't' },
]

describe('bindServeActivity Cloud adapter', () => {
  it.each(disabledEnvironments)(
    'installs no subscriptions, reads or reports when mirroring is disabled: %j',
    async (env) => {
      const calls: string[] = []
      const activity = bindServeActivity({
        env,
        threadId,
        remote,
        log: () => undefined,
        reporter: {
          report: () => {
            calls.push('report')
          },
          whenIdle: async () => {
            calls.push('idle')
          },
        },
        app: {
          log: {
            head: async () => {
              calls.push('head')
              return 0
            },
            readOwn: async () => {
              calls.push('read')
              return []
            },
          } as never,
          channel: {
            subscribe: () => {
              calls.push('channel')
              return () => undefined
            },
          },
          roster: {
            snapshot: () => {
              calls.push('snapshot')
              return { agents: [], shells: [], services: [] }
            },
            subscribe: () => {
              calls.push('roster')
              return () => undefined
            },
          },
        },
      })
      expect(activity).toBe(NOOP_SERVE_ACTIVITY)
      activity.tracker.turnStarted()
      activity.detach()
      await activity.reportParked()
      expect(calls).toEqual([])
    },
  )

  it.each(enabledEnvironments)(
    'delegates lifecycle and awaits the exact parked PATCH flush: %j',
    async (env) => {
      const states: ActivityState[] = []
      const gate = Promise.withResolvers<void>()
      const calls: string[] = []
      const activity = bindServeActivity({
        env,
        threadId,
        remote,
        app: app(),
        log: () => undefined,
        reporter: {
          report: (state) => {
            states.push(state)
            calls.push('report')
          },
          whenIdle: () => {
            calls.push('idle')
            return gate.promise
          },
        },
      })
      activity.tracker.turnStarted()
      activity.tracker.turnOutcome({ status: ETurnStatus.Completed, runId: toRunId('run') })
      activity.tracker.turnEnded()
      let parked = false
      const parking = activity.reportParked().then(() => {
        parked = true
      })
      await Promise.resolve()
      expect(parked).toBe(false)
      expect(states).toEqual([
        { working: true, awaiting: null },
        { working: false, awaiting: null, lastOutcome: 'completed' },
        { working: false, awaiting: null },
      ])
      expect(Object.hasOwn(states.at(-1) ?? {}, 'lastOutcome')).toBe(false)
      expect(calls.slice(-2)).toEqual(['report', 'idle'])
      gate.resolve()
      await parking
      expect(parked).toBe(true)
      activity.detach()
    },
  )

  it('constructs the root HTTP reporter without adding a child threadId or null outcome', async () => {
    const bodies: unknown[] = []
    const activity = bindServeActivity({
      env: { [API_PROVISIONED_ENV]: '1' },
      threadId,
      app: app(),
      log: () => undefined,
      remote: {
        ...remote,
        fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
          expect(String(input)).toBe(
            trpcUrl({ controlPlaneUrl: 'http://api', procedure: 'sandboxSelf.activity' }),
          )
          bodies.push(JSON.parse(String(init?.body)))
          return trpcOk(null)
        }) as typeof fetch,
      },
    })
    activity.tracker.turnStarted()
    await activity.reportParked()
    expect(bodies).toEqual([{ working: false, awaiting: null }])
    activity.detach()
  })
})
