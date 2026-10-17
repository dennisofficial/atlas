import { EConnectionView, type CloudChannel } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import type { Scenario, ScenarioContext } from './rig-context'
import { EVerdict, ScenarioFailed, sawInOrder, type Observation, type ScenarioEvidence } from './rig-evidence'
import type { RigApp } from './rig-mount'
import { bannerIn, waitFor, warnNotices, watchChannel, type ChannelWatch } from './rig-observer'
import {
  type Criterion,
  EvidencedScenarioFailed,
  PARK_WITHIN_MS,
  PARKED_PROVIDERS,
  criteriaText,
  frameLineFor,
  standardLogs,
  waitForPark,
} from './rig-park-wait'
import { serveSessionMatchesLive, stopRefusalsInServeLog } from './rig-session-check'
import { transcriptOf } from './rig-transcript'

const ID = 4
const SLUG = 'wake-command'
const TITLE = '/wake'
const PROVIDER_SETTLE_MS = 90_000
const WAKE_WITHIN_MS = 5 * 60_000
const SERVING_WITHIN_MS = 90_000
const SERVING_EVERY_MS = 5_000
const WAKE_COMMAND = '/wake'
const USER_SAID = 'user-said'

export type EvidenceDraft = Omit<ScenarioEvidence, 'verdict' | 'failure' | 'reason'>

export type Criteria = {
  check: (criterion: Criterion) => boolean
  text: () => string
  throwFirstFailure: (draft: EvidenceDraft) => void
}

export function createCriteria(args: { log: (line: string) => void }): Criteria {
  const checked: Criterion[] = []
  return {
    check: (criterion) => {
      checked.push(criterion)
      args.log(criteriaText([criterion]))
      return criterion.held
    },
    text: () => criteriaText(checked),
    throwFirstFailure: (draft) => {
      const failed = checked.find((criterion) => !criterion.held)
      if (failed === undefined) return
      const failure = { step: failed.name, expected: failed.expected, observed: failed.observed }
      throw new EvidencedScenarioFailed({ failure, evidence: { ...draft, verdict: EVerdict.Fail, failure } })
    },
  }
}

export const withPartialEvidence = (args: { failure: unknown; draft: EvidenceDraft }): unknown => {
  if (args.failure instanceof EvidencedScenarioFailed || !(args.failure instanceof ScenarioFailed)) return args.failure
  const failure = args.failure.failure
  return new EvidencedScenarioFailed({ failure, evidence: { ...args.draft, verdict: EVerdict.Fail, failure } })
}

export const requireChannel = (args: { rig: RigApp; step: string }): CloudChannel => {
  const channel = args.rig.channel()
  if (channel !== null) return channel
  throw new ScenarioFailed({ step: args.step, expected: 'an attached cloud channel', observed: 'no channel' })
}

export const userMessageCount = async (rig: RigApp): Promise<number> =>
  (await transcriptOf({ rig })).filter((event) => event.body?.type === USER_SAID).length

export const noticeText = (notices: readonly { tone: string; text: string }[]): string =>
  notices.length === 0 ? 'none' : notices.map((notice) => `[${notice.tone}] ${notice.text}`).join(' | ')

export async function waitForServingRecord(args: { ctx: ScenarioContext; within: number }): Promise<string | null> {
  let phase: string | null = null
  await waitFor({
    what: 'box record serving',
    within: args.within,
    every: SERVING_EVERY_MS,
    holds: async () => {
      const probe = await args.ctx.probes.box({ name: args.ctx.sandboxName(), logLines: 1 }).catch(() => null)
      phase = probe?.record?.phase ?? null
      return phase === ERuntimePhase.Serving
    },
  })
  return phase
}

export const observationOf = (args: {
  step: string
  watch: ChannelWatch
  note?: string | undefined
  provider?: string | null | undefined
  stamps?: string | null | undefined
}): Observation => ({
  at: new Date().toISOString(),
  step: args.step,
  view: args.watch.views().at(-1) ?? null,
  phase: args.watch.lastPhase(),
  stamps: args.stamps ?? null,
  provider: args.provider ?? null,
  note: args.note,
})

const checkPark = async (args: {
  ctx: ScenarioContext
  watch: ChannelWatch
  channel: CloudChannel
  draft: EvidenceDraft
}): Promise<void> => {
  const park = await waitForPark({ ctx: args.ctx, watch: args.watch, within: PARK_WITHIN_MS + PROVIDER_SETTLE_MS })
  args.draft.observations.push(...park.observations)
  args.draft.logs.push({ label: 'serve log tail before the park', text: park.lastLogTail ?? '(never read)' })
  const frame = await args.ctx.rig().frame()
  const view = args.channel.connection().state
  const phase = args.watch.lastPhase()
  const notices = warnNotices()
  const banner = bannerIn(frame)
  const sidebar = frameLineFor({ frame, view: EConnectionView.Parked })
  const criteria = createCriteria({ log: args.ctx.log })
  criteria.check({ name: 'park: client record phase', expected: ERuntimePhase.Parked, observed: phase ?? 'none', held: phase === ERuntimePhase.Parked })
  criteria.check({ name: 'park: provider not running', expected: [...PARKED_PROVIDERS].join(' / '), observed: park.provider, held: PARKED_PROVIDERS.has(park.provider) })
  criteria.check({ name: 'park: channel view', expected: EConnectionView.Parked, observed: view, held: view === EConnectionView.Parked })
  criteria.check({ name: 'park: warn notices', expected: 'none', observed: noticeText(notices), held: notices.length === 0 })
  criteria.check({ name: 'park: frame banner', expected: 'none', observed: banner ?? 'none', held: banner === null })
  criteria.check({ name: 'park: sidebar shows parked', expected: 'a "○ parked" frame line', observed: sidebar ?? 'no such line', held: sidebar !== null })
  args.draft.logs.push({ label: 'park criteria', text: criteria.text() })
  criteria.throwFirstFailure(args.draft)
}

async function runWakeCmd(ctx: ScenarioContext): Promise<ScenarioEvidence> {
  const rig = ctx.rig()
  const draft: EvidenceDraft = {
    id: ID,
    slug: SLUG,
    title: TITLE,
    commands: [
      `wait ≤${PARK_WITHIN_MS / 60_000} min (+${PROVIDER_SETTLE_MS / 1000} s provider settle) for a park, with scenario 2's criteria`,
      'count the user-said events in the cloud transcript (U0)',
      `submit ${WAKE_COMMAND}`,
      `wait ≤${WAKE_WITHIN_MS / 60_000} min for waking → connected, then ≤${SERVING_WITHIN_MS / 1000} s for the box record serving`,
    ],
    observations: [],
    logs: [],
  }
  const channel = requireChannel({ rig, step: 'park precondition' })
  const watch = watchChannel({ channel, log: (line) => ctx.log(`[s${ID}] ${line}`) })
  try {
    await checkPark({ ctx, watch, channel, draft })

    const userBefore = await userMessageCount(rig)
    const viewMark = watch.views().length
    const viewsSinceWake = (): string[] => watch.views().slice(viewMark)
    await rig.submit(WAKE_COMMAND)
    draft.observations.push(observationOf({ step: `submitted ${WAKE_COMMAND}`, watch, note: `U0=${userBefore}` }))

    await waitFor({
      what: 'waking then connected',
      within: WAKE_WITHIN_MS,
      holds: () => sawInOrder({ timeline: viewsSinceWake(), states: [EConnectionView.Waking, EConnectionView.Connected] }),
    })
    const servingPhase = await waitForServingRecord({ ctx, within: SERVING_WITHIN_MS })
    const probe = await ctx.probes.box({ name: ctx.sandboxName() }).catch(() => null)
    draft.observations.push(
      observationOf({
        step: `after ${WAKE_COMMAND}`,
        watch,
        provider: probe?.provider,
        stamps: probe === null || probe.version === null ? null : `${probe.version} / ${probe.protocol ?? '?'}`,
        note: probe?.servePid ? `serve pid ${probe.servePid}` : undefined,
      }),
    )

    const session = await serveSessionMatchesLive(ctx)
    const refusals = await stopRefusalsInServeLog(ctx)
    const userAfter = await userMessageCount(rig)
    const frame = await rig.frame()
    const notices = warnNotices()
    const banner = bannerIn(frame)
    const since = viewsSinceWake()
    const criteria = createCriteria({ log: ctx.log })
    criteria.check({ name: 'views after /wake', expected: 'waking then connected', observed: since.join(' → ') || 'none', held: sawInOrder({ timeline: since, states: [EConnectionView.Waking, EConnectionView.Connected] }) })
    criteria.check({ name: 'box record', expected: ERuntimePhase.Serving, observed: servingPhase ?? 'none', held: servingPhase === ERuntimePhase.Serving })
    criteria.check({ name: 'user messages', expected: `still ${userBefore} (/wake sends nothing)`, observed: String(userAfter), held: userAfter === userBefore })
    criteria.check({ name: 'warn notices', expected: 'none', observed: noticeText(notices), held: notices.length === 0 })
    criteria.check({ name: 'frame banner', expected: 'none', observed: banner ?? 'none', held: banner === null })
    criteria.check({ name: 'serve session id is the live session', expected: 'equal', observed: session.observed, held: session.held })
    criteria.check({ name: 'no stop refusal on any park', expected: '0 park-stop-failed / refusing-to-stop lines', observed: refusals.observed, held: refusals.held })
    draft.logs.unshift({ label: 'criteria', text: criteria.text() })
    draft.logs.push(
      ...standardLogs({ watch, logTail: probe?.logTail ?? null, driverLines: rig.driverLines }),
      { label: 'frame at the end', text: frame },
    )
    criteria.throwFirstFailure(draft)
    return { ...draft, verdict: EVerdict.Pass }
  } catch (failure) {
    throw withPartialEvidence({ failure, draft })
  } finally {
    watch.stop()
  }
}

export const wakeCmdScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runWakeCmd }
