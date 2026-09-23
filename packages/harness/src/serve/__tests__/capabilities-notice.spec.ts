import { describe, expect, it } from 'bun:test'

import {
  EPortExposure,
  toEventId,
  toRunId,
  toThreadId,
  type EnvironmentCapabilities,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import {
  CAPABILITIES_NOTICE_KEY,
  CAPABILITIES_NOTICE_SLOT,
  syncCapabilitiesNotice,
} from '../capabilities-notice'

const THREAD = toThreadId('brn_capabilities-notice')

const capabilities: EnvironmentCapabilities = {
  canPush: true,
  gitIdentity: 'Dennis <dennis@example.com>',
  gpgSigning: true,
  dockerAvailable: false,
  persistentFs: true,
  serviceTtlSeconds: 1_800,
  portExposure: EPortExposure.PublicDomain,
  failures: [],
}

const logOf = () => {
  const appended: EventDraft[] = []
  return {
    appended,
    log: {
      append: async (given: { drafts: readonly EventDraft[] }): Promise<Event[]> => {
        appended.push(...given.drafts)
        return []
      },
    },
  }
}

const stamped = (args: { seq: number; draft: EventDraft }): Event => {
  if (args.draft.type !== 'context-loaded') throw new Error('expected a context-loaded draft')
  return {
    id: toEventId(`evt_${args.seq}`),
    seq: args.seq,
    threadId: THREAD,
    runId: toRunId(`run_${args.seq}`),
    depth: 0,
    at: '2026-09-22T00:00:00.000Z',
    type: 'context-loaded',
    slot: args.draft.slot,
    key: args.draft.key,
    content: args.draft.content,
  }
}

describe('syncCapabilitiesNotice', () => {
  it('appends the probed descriptor to the log when none is current', async () => {
    const { log, appended } = logOf()

    const synced = await syncCapabilitiesNotice({
      log,
      threadId: THREAD,
      runId: toRunId('run_1'),
      events: [],
      capabilities,
    })

    expect(synced).toBe(true)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      type: 'context-loaded',
      slot: CAPABILITIES_NOTICE_SLOT,
      key: CAPABILITIES_NOTICE_KEY,
    })
    expect(appended[0]?.type === 'context-loaded' && appended[0].content).toContain(
      'git push/PR/CI from here: yes',
    )
    expect(appended[0]?.type === 'context-loaded' && appended[0].content).toContain(
      'about 30 minutes',
    )
  })

  it('stays silent when the current descriptor already says what the probe says', async () => {
    const { log, appended } = logOf()
    const first = await syncCapabilitiesNotice({
      log,
      threadId: THREAD,
      runId: toRunId('run_1'),
      events: [],
      capabilities,
    })
    if (!first || appended[0] === undefined) throw new Error('expected the first sync to append')
    const stored = [stamped({ seq: 1, draft: appended[0] })]

    const second = await syncCapabilitiesNotice({
      log,
      threadId: THREAD,
      runId: toRunId('run_2'),
      events: stored,
      capabilities,
    })

    expect(second).toBe(false)
    expect(appended).toHaveLength(1)
  })

  it('re-states the descriptor when the probe answers differently than the log does', async () => {
    const { log, appended } = logOf()
    const stale = [
      stamped({
        seq: 1,
        draft: {
          type: 'context-loaded',
          slot: CAPABILITIES_NOTICE_SLOT,
          key: CAPABILITIES_NOTICE_KEY,
          content: 'This environment’s probed capabilities:\n- git push/PR/CI from here: no',
        },
      }),
    ]

    const synced = await syncCapabilitiesNotice({
      log,
      threadId: THREAD,
      runId: toRunId('run_1'),
      events: stale,
      capabilities: { ...capabilities, canPush: false },
    })

    expect(synced).toBe(true)
    expect(appended).toHaveLength(1)
  })
})
