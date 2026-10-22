import { EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import type { Scenario, ScenarioContext } from './rig-context'
import type { Observation, ScenarioEvidence } from './rig-evidence'
import { bannerIn, warnNotices, watchChannel } from './rig-observer'
import {
  type Criterion,
  PARK_POLL_MS,
  PARK_WITHIN_MS,
  PARKED_PROVIDERS,
  concluded,
  frameLineFor,
  frameNoteOf,
  standardLogs,
  waitForPark,
} from './rig-park-wait'

const ID = 2
const SLUG = 'idle-park'
const TITLE = 'Idle park'
const PROVIDER_SETTLE_MS = 90_000
const STEP = 'idle park'
const FIRST_ATTEMPT_WITHIN_MS = 7.5 * 60_000
const REFUSAL = /refusing the lifecycle transition|serve\.park-stop-failed|serve\.park-refused/

const minutesOf = (ms: number): string => `${(ms / 60_000).toFixed(2)} min`

const idleToParkOf = (args: {
  repliedAt: string | undefined
  parkedAtMs: number | null
}): number | null => {
  if (args.repliedAt === undefined || args.parkedAtMs === null) return null
  return args.parkedAtMs - Number(args.repliedAt)
}

const noticeText = (notices: readonly { tone: string; text: string }[]): string =>
  notices.length === 0
    ? 'none'
    : notices.map((notice) => `[${notice.tone}] ${notice.text}`).join(' | ')

async function runPark(ctx: ScenarioContext): Promise<ScenarioEvidence> {
  const rig = ctx.rig()
  const commands = [
    `watch the channel of thread ${rig.threadId} (sandbox ${ctx.sandboxName()})`,
    `poll every ${PARK_POLL_MS / 1000} s for ≤${PARK_WITHIN_MS / 60_000} min, plus ≤${PROVIDER_SETTLE_MS / 1000} s for the provider to leave running: client record phase, channel view, box probe (60 log lines while running)`,
    'read warn notices, the rendered frame and the final channel view',
  ]
  const base = { id: ID, slug: SLUG, title: TITLE, commands }
  const channel = rig.channel()
  if (channel === null) {
    return concluded({
      step: STEP,
      evidence: { ...base, observations: [], logs: [] },
      criteria: [
        {
          name: 'channel attached',
          expected: 'an attached cloud channel',
          observed: 'no channel',
          held: false,
        },
      ],
    })
  }

  const watch = watchChannel({ channel, log: (line) => ctx.log(`[s${ID}] ${line}`) })
  try {
    const park = await waitForPark({ ctx, watch, within: PARK_WITHIN_MS + PROVIDER_SETTLE_MS })
    const frame = await rig.frame()
    const view = channel.connection().state
    const phase = watch.lastPhase()
    const notices = warnNotices()
    const banner = bannerIn(frame)
    const sidebar = frameLineFor({ frame, view: EConnectionView.Parked })
    const idleToPark = idleToParkOf({
      repliedAt: ctx.shared.get('turnRepliedAt'),
      parkedAtMs: park.parkedAtMs,
    })
    const settled: Observation = {
      at: new Date().toISOString(),
      step: park.parkedAtMs === null ? 'park wait timed out' : 'parked',
      view,
      phase,
      stamps: null,
      provider: park.provider,
      note: frameNoteOf({ frame, view }),
    }

    const criteria: Criterion[] = [
      {
        name: 'client record phase',
        expected: ERuntimePhase.Parked,
        observed: phase ?? 'none',
        held: phase === ERuntimePhase.Parked,
      },
      {
        name: 'provider not running',
        expected: [...PARKED_PROVIDERS].join(' / '),
        observed: park.provider,
        held: PARKED_PROVIDERS.has(park.provider),
      },
      {
        name: 'channel view',
        expected: EConnectionView.Parked,
        observed: view,
        held: view === EConnectionView.Parked,
      },
      {
        name: 'warn notices',
        expected: 'none',
        observed: noticeText(notices),
        held: notices.length === 0,
      },
      { name: 'frame banner', expected: 'none', observed: banner ?? 'none', held: banner === null },
      {
        name: 'sidebar shows parked',
        expected: 'a "○ parked" frame line',
        observed: sidebar ?? 'no such line',
        held: sidebar !== null,
      },
      {
        name: 'first idle attempt parks',
        expected: 'no refused or failed park in the serve log',
        observed: park.lastLogTail?.split('\n').find((line) => REFUSAL.test(line)) ?? 'none',
        held: park.lastLogTail?.split('\n').some((line) => REFUSAL.test(line)) !== true,
      },
      {
        name: 'idle-to-park time',
        expected: `≤ ${minutesOf(FIRST_ATTEMPT_WITHIN_MS)} from the last reply to the client seeing parked (5 min window + 30 s tick + 15 s poll)`,
        observed: idleToPark === null ? 'unmeasured' : minutesOf(idleToPark),
        held: idleToPark !== null && idleToPark <= FIRST_ATTEMPT_WITHIN_MS,
      },
    ]

    return concluded({
      step: STEP,
      evidence: {
        ...base,
        observations: [...park.observations, settled],
        logs: [
          ...standardLogs({ watch, logTail: park.lastLogTail, driverLines: rig.driverLines }),
          { label: 'frame at the end', text: frame },
        ],
      },
      criteria,
    })
  } finally {
    watch.stop()
  }
}

export const parkScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runPark }
