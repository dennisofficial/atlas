import { EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import type { Scenario, ScenarioContext } from './rig-context'
import { EVerdict, type Observation, type ScenarioEvidence } from './rig-evidence'
import { waitFor } from './rig-observer'
import { EvidencedScenarioFailed, messageOf } from './rig-park-wait'
import type { BoxProbe } from './rig-probes'
import { assistantSaid, transcriptLines, transcriptOf, userSaidCount } from './rig-transcript'

const ID = 1
const SLUG = 'fresh'
const TITLE = 'Fresh cloud birth'
const PROMPT = 'Reply with the single word READY.'
const REPLY_WORD = 'READY'
const REPLY_WITHIN_MS = 5 * 60_000
const REPLY_EVERY_MS = 5_000
const PROBE_LOG_LINES = 60
const SENTINEL_PATH = '/opt/atlas/workspaces/workspace/rig-sentinel.txt'
const SENTINEL_SCRIPT = `v=rig-$(date +%s%N); printf %s "$v" > ${SENTINEL_PATH}; printf %s "$v"`
const SENTINEL_PATTERN = /^rig-\d+$/

type Draft = {
  commands: string[]
  observations: Observation[]
  logs: { label: string; text: string }[]
}

const stampsOf = (probe: BoxProbe): string | null =>
  probe.version === null ? null : `${probe.version} / protocol ${probe.protocol ?? '?'}`

const fail = (args: { draft: Draft; step: string; expected: string; observed: string }): never => {
  const failure = { step: args.step, expected: args.expected, observed: args.observed }
  throw new EvidencedScenarioFailed({
    failure,
    evidence: { id: ID, slug: SLUG, title: TITLE, ...args.draft, verdict: EVerdict.Fail, failure },
  })
}

const observe = (args: {
  ctx: ScenarioContext
  draft: Draft
  step: string
  probe?: BoxProbe | undefined
  note?: string | undefined
}): void => {
  const channel = args.ctx.rig().channel()
  args.draft.observations.push({
    at: new Date().toISOString(),
    step: args.step,
    view: channel?.connection().state ?? null,
    phase: args.probe?.record?.phase ?? channel?.checkpoint?.()?.phase ?? null,
    stamps: args.probe === undefined ? null : stampsOf(args.probe),
    provider: args.probe?.provider ?? null,
    note: args.note,
  })
}

const waitForReady = async (args: { ctx: ScenarioContext; draft: Draft }): Promise<void> => {
  let lastError: string | null = null
  let lastEvents: readonly unknown[] = []
  const replied = await waitFor({
    what: `the cloud transcript to hold a ${REPLY_WORD} reply`,
    within: REPLY_WITHIN_MS,
    every: REPLY_EVERY_MS,
    holds: async () => {
      const rig = args.ctx.rig()
      if (rig.channel() === null || rig.cloudLog() === null) return false
      try {
        lastEvents = await transcriptOf({ rig })
        lastError = null
      } catch (error) {
        lastError = messageOf(error)
        return false
      }
      return userSaidCount({ events: lastEvents, text: PROMPT }) > 0 && assistantSaid({ events: lastEvents, word: REPLY_WORD })
    },
  })
  args.draft.logs.push({ label: 'cloud transcript', text: transcriptLines(lastEvents) })
  observe({ ctx: args.ctx, draft: args.draft, step: replied ? 'turn replied' : 'reply wait timed out', note: lastError ?? undefined })
  if (replied) return
  const rig = args.ctx.rig()
  const observed =
    rig.channel() === null
      ? 'no cloud channel was ever attached'
      : `${lastEvents.length} transcript events without a ${REPLY_WORD} reply${lastError === null ? '' : `; last read failed: ${lastError}`}`
  fail({ draft: args.draft, step: 'wait for the READY turn', expected: `a ${REPLY_WORD} reply within ${REPLY_WITHIN_MS / 60_000} min`, observed })
}

const checkServingBox = async (args: { ctx: ScenarioContext; draft: Draft }): Promise<void> => {
  const name = args.ctx.sandboxName()
  const probe = await args.ctx.probes.box({ name, logLines: PROBE_LOG_LINES })
  observe({ ctx: args.ctx, draft: args.draft, step: 'box probe', probe, note: probe.recordError ?? undefined })
  args.draft.logs.push({ label: `serve log tail (${PROBE_LOG_LINES} lines)`, text: probe.logTail ?? '(not read: the box was not running)' })
  const view = args.ctx.rig().channel()?.connection().state ?? 'no channel'
  const misses = [
    probe.record?.phase === ERuntimePhase.Serving ? null : `record phase ${probe.record?.phase ?? probe.recordError ?? 'unread'}`,
    view === EConnectionView.Connected ? null : `view ${view}`,
    probe.version !== null && probe.protocol !== null ? null : `stamps ${stampsOf(probe) ?? 'missing'}`,
  ].filter((miss): miss is string => miss !== null)
  if (misses.length === 0) return
  fail({
    draft: args.draft,
    step: 'box serving',
    expected: `record ${ERuntimePhase.Serving}, view ${EConnectionView.Connected}, version and protocol stamps present (provider ${probe.provider})`,
    observed: misses.join('; '),
  })
}

const writeSentinel = async (args: { ctx: ScenarioContext; draft: Draft }): Promise<void> => {
  let sentinel: string
  try {
    sentinel = (await args.ctx.probes.sh({ name: args.ctx.sandboxName(), script: SENTINEL_SCRIPT })).trim()
  } catch (error) {
    return fail({ draft: args.draft, step: 'write sentinel', expected: `${SENTINEL_PATH} written`, observed: messageOf(error) })
  }
  if (!SENTINEL_PATTERN.test(sentinel)) {
    fail({ draft: args.draft, step: 'write sentinel', expected: 'a rig-<nanoseconds> value echoed back', observed: sentinel || '(empty)' })
  }
  args.ctx.shared.set('sentinel', sentinel)
  observe({ ctx: args.ctx, draft: args.draft, step: 'sentinel written', note: `${SENTINEL_PATH} = ${sentinel}` })
}

async function runFresh(ctx: ScenarioContext): Promise<ScenarioEvidence> {
  const draft: Draft = {
    commands: [
      'mount the App headlessly on a fresh unstarted conversation and flip the placement chip to ☁ cloud',
      `submit "${PROMPT}"`,
      `wait ≤${REPLY_WITHIN_MS / 60_000} min for the cloud transcript to hold the prompt and a ${REPLY_WORD} reply`,
      `probe the box (${PROBE_LOG_LINES} log lines): record phase, version/protocol stamps, serve pid`,
      `write the sentinel: ${SENTINEL_SCRIPT}`,
    ],
    observations: [],
    logs: [],
  }
  const rig = ctx.rig()
  observe({ ctx, draft, step: 'mounted, chip on cloud' })
  await rig.submit(PROMPT)
  observe({ ctx, draft, step: 'prompt submitted', note: `thread ${rig.threadId}` })
  ctx.log(`[s${ID}] submitted; sandbox ${ctx.sandboxName()}`)
  await waitForReady({ ctx, draft })
  await checkServingBox({ ctx, draft })
  await writeSentinel({ ctx, draft })
  return { id: ID, slug: SLUG, title: TITLE, ...draft, verdict: EVerdict.Pass }
}

export const freshScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runFresh }
