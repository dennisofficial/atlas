import { EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import type { Scenario, ScenarioContext } from './rig-context'
import { sawInOrder, type Observation, type ScenarioEvidence } from './rig-evidence'
import type { RigApp } from './rig-mount'
import { waitFor, watchChannel, type ChannelWatch } from './rig-observer'
import {
  type Criterion,
  PARK_WITHIN_MS,
  concluded,
  frameNoteOf,
  messageOf,
  standardLogs,
  waitForPark,
} from './rig-park-wait'
import type { BoxProbe } from './rig-probes'
import { serveSessionMatchesLive, stopRefusalsInServeLog } from './rig-session-check'
import {
  assistantSaid,
  transcriptLines,
  transcriptOf,
  userSaidCount,
  type TranscriptEvent,
} from './rig-transcript'
import { rigSentinelPath } from './rig-workspace'

const ID = 3
const SLUG = 'wake-on-send'
const TITLE = 'Wake on send'
const STEP = 'wake on send'
const PROMPT = 'Reply with the single word AWAKE.'
const REPLY_WORD = 'AWAKE'
const WAKE_PATH = [EConnectionView.Waking, EConnectionView.Connected]
const WAKE_WITHIN_MS = 5 * 60_000
const WAKE_EVERY_MS = 5_000
const SERVING_WITHIN_MS = 90_000
const SERVING_EVERY_MS = 5_000
const PROBE_LOG_LINES = 60
const USER_SAID = 'user-said'

type Run = { ctx: ScenarioContext; rig: RigApp; watch: ChannelWatch; observations: Observation[] }

const stampsOf = (probe: BoxProbe | null): string | null =>
  probe?.version === null || probe === null
    ? null
    : `${probe.version} / protocol ${probe.protocol ?? '?'}`

const observe = async (args: {
  run: Run
  step: string
  probe?: BoxProbe | null | undefined
  note?: string | undefined
}): Promise<void> => {
  const frame = await args.run.rig.frame()
  const view = args.run.rig.channel()?.connection().state ?? null
  const frameNote = frameNoteOf({ frame, view })
  args.run.observations.push({
    at: new Date().toISOString(),
    step: args.step,
    view,
    phase: args.run.watch.lastPhase(),
    stamps: stampsOf(args.probe ?? null),
    provider: args.probe?.provider ?? null,
    note: args.note === undefined ? frameNote : `${args.note}; ${frameNote}`,
  })
}

const lastPromptIndex = (events: readonly TranscriptEvent[]): number =>
  events.findLastIndex(
    (event) => event.body?.type === USER_SAID && event.body.text?.trim() === PROMPT,
  )

const readTranscript = async (
  rig: RigApp,
): Promise<{ events: readonly TranscriptEvent[]; error: string | null }> => {
  try {
    return { events: await transcriptOf({ rig }), error: null }
  } catch (error) {
    return { events: [], error: messageOf(error) }
  }
}

const replied = (events: readonly TranscriptEvent[]): boolean => {
  const promptAt = lastPromptIndex(events)
  return promptAt >= 0 && assistantSaid({ events, word: REPLY_WORD, afterIndex: promptAt })
}

const waitForServing = async (
  ctx: ScenarioContext,
): Promise<{ probe: BoxProbe | null; error: string | null }> => {
  let probe: BoxProbe | null = null
  let error: string | null = null
  await waitFor({
    what: 'box record serving',
    within: SERVING_WITHIN_MS,
    every: SERVING_EVERY_MS,
    holds: async () => {
      try {
        probe = await ctx.probes.box({ name: ctx.sandboxName(), logLines: PROBE_LOG_LINES })
        error = null
      } catch (failure) {
        error = messageOf(failure)
        return false
      }
      return probe.record?.phase === ERuntimePhase.Serving
    },
  })
  return { probe, error }
}

const readSentinel = async (ctx: ScenarioContext): Promise<string> => {
  try {
    return await ctx.probes.sh({
      name: ctx.sandboxName(),
      script: `cat ${rigSentinelPath({ repo: ctx.shared.get('repo') })}`,
    })
  } catch (error) {
    return `(read failed: ${messageOf(error)})`
  }
}

async function runWakeSend(ctx: ScenarioContext): Promise<ScenarioEvidence> {
  const rig = ctx.rig()
  const commands: string[] = [
    `watch the channel of thread ${rig.threadId} (sandbox ${ctx.sandboxName()})`,
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
  const run: Run = { ctx, rig, watch, observations: [] }
  let logTail: string | null = null
  try {
    await observe({ run, step: 'start' })
    if (channel.connection().state !== EConnectionView.Parked) {
      commands.push(
        `the view is ${channel.connection().state}, not parked: wait ≤${PARK_WITHIN_MS / 60_000} min for a park`,
      )
      const park = await waitForPark({ ctx, watch, within: PARK_WITHIN_MS })
      run.observations.push(...park.observations)
      logTail = park.lastLogTail
    }
    const startView = channel.connection().state
    await observe({ run, step: 'precondition' })
    const logsNow = (extra: readonly { label: string; text: string }[]) => [
      ...standardLogs({ watch, logTail, driverLines: rig.driverLines }),
      ...extra,
    ]
    if (startView !== EConnectionView.Parked) {
      return concluded({
        step: `${STEP} precondition`,
        evidence: { ...base, observations: run.observations, logs: logsNow([]) },
        criteria: [
          {
            name: 'view parked before the send',
            expected: EConnectionView.Parked,
            observed: startView,
            held: false,
          },
        ],
      })
    }

    const viewMark = watch.views().length - 1
    const viewsSinceSend = (): string[] => watch.views().slice(viewMark)
    commands.push(`submit "${PROMPT}" into the composer while parked`)
    await rig.submit(PROMPT)
    await observe({ run, step: 'submitted' })

    commands.push(
      `wait ≤${WAKE_WITHIN_MS / 60_000} min for views ${WAKE_PATH.join(' → ')} and an assistant reply containing ${REPLY_WORD}`,
    )
    let transcript = await readTranscript(rig)
    await waitFor({
      what: 'woke and replied',
      within: WAKE_WITHIN_MS,
      every: WAKE_EVERY_MS,
      holds: async () => {
        if (!sawInOrder({ timeline: viewsSinceSend(), states: WAKE_PATH })) return false
        transcript = await readTranscript(rig)
        return replied(transcript.events)
      },
    })
    transcript = await readTranscript(rig)
    await observe({
      run,
      step: 'after the wake',
      note: transcript.error === null ? undefined : `transcript read failed: ${transcript.error}`,
    })

    commands.push(
      `probe the box every ${SERVING_EVERY_MS / 1000} s for ≤${SERVING_WITHIN_MS / 1000} s until its record reads serving`,
    )
    const serving = await waitForServing(ctx)
    logTail = serving.probe?.logTail ?? logTail
    await observe({
      run,
      step: 'box record',
      probe: serving.probe,
      note: serving.error === null ? undefined : `probe failed: ${serving.error}`,
    })

    commands.push(`cat ${rigSentinelPath({ repo: ctx.shared.get('repo') })}`)
    const expectedSentinel = ctx.shared.get('sentinel') ?? null
    const sentinel = await readSentinel(ctx)
    const session = await serveSessionMatchesLive(ctx)
    const refusals = await stopRefusalsInServeLog(ctx)

    const views = viewsSinceSend()
    const userCount = userSaidCount({ events: transcript.events, text: PROMPT })
    const rawCount = JSON.stringify(transcript.events).split(PROMPT).length - 1
    const boxPhase = serving.probe?.record?.phase ?? null
    const criteria: Criterion[] = [
      {
        name: 'views since the send',
        expected: WAKE_PATH.join(' then '),
        observed: views.join(' → '),
        held: sawInOrder({ timeline: views, states: WAKE_PATH }),
      },
      {
        name: 'user message once in the cloud transcript',
        expected: '1 user-said event',
        observed: `${userCount} user-said event(s), ${rawCount} raw occurrence(s)${transcript.error === null ? '' : `; read failed: ${transcript.error}`}`,
        held: userCount === 1,
      },
      {
        name: `reply contains ${REPLY_WORD}`,
        expected: `an assistant-said after the prompt containing ${REPLY_WORD}`,
        observed: replied(transcript.events) ? 'present' : 'absent',
        held: replied(transcript.events),
      },
      {
        name: 'box record serving',
        expected: ERuntimePhase.Serving,
        observed:
          boxPhase ??
          (serving.error === null
            ? `no record (provider ${serving.probe?.provider ?? 'unprobed'})`
            : `probe failed: ${serving.error}`),
        held: boxPhase === ERuntimePhase.Serving,
      },
      {
        name: 'sentinel unchanged',
        expected: expectedSentinel ?? '(scenario 1 stored no sentinel)',
        observed: sentinel,
        held: expectedSentinel !== null && sentinel === expectedSentinel,
      },
      {
        name: 'serve session id is the live session',
        expected: 'equal',
        observed: session.observed,
        held: session.held,
      },
      {
        name: 'no stop refusal on any park',
        expected: '0 park-stop-failed / refusing-to-stop lines',
        observed: refusals.observed,
        held: refusals.held,
      },
    ]

    return concluded({
      step: STEP,
      evidence: {
        ...base,
        observations: run.observations,
        logs: logsNow([
          { label: 'cloud transcript', text: transcriptLines(transcript.events) },
          { label: 'frame at the end', text: await rig.frame() },
        ]),
      },
      criteria,
    })
  } finally {
    watch.stop()
  }
}

export const wakeSendScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runWakeSend }
