import { EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase, SERVE_VERSION_PATH } from '@dltech/atlas-wire'

import type { Scenario, ScenarioContext } from './rig-context'
import { EVerdict, ScenarioFailed, type ScenarioEvidence } from './rig-evidence'
import type { RigApp } from './rig-mount'
import { waitFor, watchChannel, type ChannelWatch } from './rig-observer'
import {
  type EvidenceDraft,
  createCriteria,
  observationOf,
  requireChannel,
  waitForServingRecord,
  withPartialEvidence,
} from './rig-scenario-wake-cmd'
import { markServeSource } from './rig-source-mark'
import {
  DRAIN_SEALED_LINE,
  DRIVER_SWAP_LINE,
  matchingLines,
  observationsOf,
  startSwapWatch,
  type SwapWatch,
} from './rig-swap-watch'
import { serveSessionMatchesLive, stopRefusalsInServeLog } from './rig-session-check'
import { FOLLOW_UP_SEND, replyAfterSwap, turnStartedAfterBoot } from './rig-swap-after'
import { assistantSaid, transcriptOf } from './rig-transcript'

export enum EMismatch {
  SourceEdit = 'source-edit',
  ForgeStamp = 'forge-stamp',
}

const ID = 5
const SLUG = 'version-swap'
const TITLE = 'version mismatch swap'
const WAKE_WITHIN_MS = 5 * 60_000
const SERVING_WITHIN_MS = 90_000
const BG_REPLY_WITHIN_MS = 3 * 60_000
const SLEEP_SEEN_WITHIN_MS = 90_000
const CHANNEL_WITHIN_MS = 6 * 60_000
const SWAP_WITHIN_MS = 6 * 60_000
const DONE_WITHIN_MS = 4 * 60_000
const POLL_MS = 3_000
const SWAP_POLL_MS = 2_000
const SERVE_LOG_LINES = 200
const REQUIRED_PROTOCOL = 25
const DEV_PREFIX = 'dev-'
const FORGED_STAMP = 'dev-rigstale000000'
const CTL_LOG = '/tmp/rig-ctl.log'
const BG_LOG = '/tmp/rig-bg.log'
const PID_PATTERN = /^\d+$/

const tick = (file: string): string => `while true; do date +%s >> ${file}; sleep 2; done`

const BG_PROMPT = `Use the bash tool to start this as a BACKGROUND shell (background mode, not foreground): ${tick(BG_LOG)}   Then reply BGSTARTED.`
const SLEEP_PROMPT =
  'Use the bash tool to run exactly this command in the foreground (not in the background) with timeoutMs 300000: timeout 150 tail -f /dev/null; echo held   Then reply DONE.'

export const mismatchOf = (value: string | undefined): EMismatch =>
  value === EMismatch.ForgeStamp ? EMismatch.ForgeStamp : EMismatch.SourceEdit

const firstPidOf = (text: string): string | null => {
  const first = text.split('\n')[0]?.trim() ?? ''
  return PID_PATTERN.test(first) ? first : null
}

const aliveIn = async (args: { ctx: ScenarioContext; pid: string }): Promise<boolean> => {
  const script = `kill -0 ${args.pid} 2>/dev/null && echo alive || echo gone`
  return (
    (await args.ctx.probes
      .sh({ name: args.ctx.sandboxName(), script })
      .catch(() => 'unreachable')) === 'alive'
  )
}

const pgrepFirst = async (args: {
  ctx: ScenarioContext
  pattern: string
}): Promise<string | null> => {
  const script = `pgrep -f "${args.pattern}" | head -1`
  return firstPidOf(
    await args.ctx.probes.sh({ name: args.ctx.sandboxName(), script }).catch(() => ''),
  )
}

const transcriptLength = async (rig: RigApp): Promise<number> =>
  (await transcriptOf({ rig })).length

const saidAfter = async (args: {
  rig: RigApp
  word: string
  afterIndex: number
}): Promise<boolean> =>
  assistantSaid({
    events: await transcriptOf({ rig: args.rig }).catch(() => []),
    word: args.word,
    afterIndex: args.afterIndex,
  })

const waitForReply = async (args: {
  rig: RigApp
  word: string
  afterIndex: number
  within: number
}): Promise<boolean> =>
  waitFor({
    what: `a reply containing ${args.word}`,
    within: args.within,
    every: POLL_MS,
    holds: () => saidAfter(args),
  })

const stampsText = (probe: { version: string | null; protocol: number | null }): string =>
  `${probe.version ?? '—'} / ${probe.protocol ?? '?'}`

const ensureServing = async (ctx: ScenarioContext): Promise<void> => {
  const rig = ctx.rig()
  const channel = requireChannel({ rig, step: 'precondition' })
  const connected = (): boolean => channel.connection().state === EConnectionView.Connected
  if (!connected()) {
    ctx.log(`[s${ID}] view ${channel.connection().state} — submitting /wake first`)
    await rig.submit('/wake')
    await waitFor({ what: 'connected', within: WAKE_WITHIN_MS, holds: connected })
  }
  const phase = await waitForServingRecord({ ctx, within: SERVING_WITHIN_MS })
  const view = channel.connection().state
  if (view === EConnectionView.Connected && phase === ERuntimePhase.Serving) return
  throw new ScenarioFailed({
    step: 'precondition',
    expected: 'view connected and record serving',
    observed: `view ${view}, record ${phase ?? 'none'}`,
  })
}

const startControl = async (ctx: ScenarioContext): Promise<string> => {
  const out = await ctx.probes.sh({
    name: ctx.sandboxName(),
    script: `nohup sh -c "${tick(CTL_LOG)}" >/dev/null 2>&1 & echo $!`,
  })
  const pid = firstPidOf(out)
  if (pid !== null) return pid
  throw new ScenarioFailed({
    step: 'control process',
    expected: 'a detached pid',
    observed: out || 'no output',
  })
}

const startBackgroundShell = async (ctx: ScenarioContext): Promise<string> => {
  const rig = ctx.rig()
  const before = await transcriptLength(rig)
  await rig.submit(BG_PROMPT)
  const replied = await waitForReply({
    rig,
    word: 'BGSTARTED',
    afterIndex: before,
    within: BG_REPLY_WITHIN_MS,
  })
  const pid = await pgrepFirst({ ctx, pattern: 'rig-bg[.]log' })
  if (pid !== null) return pid
  throw new ScenarioFailed({
    step: 'background shell',
    expected: 'a pid matching rig-bg.log',
    observed: replied ? 'BGSTARTED replied, no pid' : 'no BGSTARTED reply and no pid',
  })
}

const applyMismatch = async (args: {
  ctx: ScenarioContext
  mode: EMismatch
  restores: (() => Promise<void>)[]
}): Promise<string> => {
  if (args.mode === EMismatch.ForgeStamp) {
    await args.ctx.probes.sh({
      name: args.ctx.sandboxName(),
      script: `printf ${FORGED_STAMP} > ${SERVE_VERSION_PATH}`,
    })
    return `forged the box stamp ${SERVE_VERSION_PATH} to ${FORGED_STAMP}`
  }
  const marked = await markServeSource()
  args.restores.push(marked.restore)
  return `appended ATLAS_RIG_MARK ${marked.mark} to apps/serve/src/main.ts`
}

const growthOf = async (
  ctx: ScenarioContext,
): Promise<{ before: number; after: number } | null> => {
  const size = `$(wc -c < ${BG_LOG} 2>/dev/null || echo 0)`
  const out = await ctx.probes
    .sh({ name: ctx.sandboxName(), script: `a=${size}; sleep 6; b=${size}; echo "$a $b"` })
    .catch(() => '')
  const [before, after] = out.trim().split(/\s+/).map(Number)
  if (before === undefined || after === undefined || Number.isNaN(before) || Number.isNaN(after))
    return null
  return { before, after }
}

const UNCONFIRMED_DRAIN = 'did not confirm preparation'

const updatingSourceOf = (args: {
  phases: readonly string[]
  views: readonly string[]
}): string => {
  const inRecord = args.phases.includes(ERuntimePhase.Updating)
  const inView = args.views.includes(EConnectionView.Updating)
  if (inRecord && inView) return 'box record and client view'
  if (inRecord) return 'box record'
  if (inView) return 'client view'
  return 'neither'
}

async function runSwap(ctx: ScenarioContext): Promise<ScenarioEvidence> {
  const mode = mismatchOf(ctx.shared.get('mismatch'))
  const draft: EvidenceDraft = {
    id: ID,
    slug: SLUG,
    title: TITLE,
    commands: [`mismatch mode ${mode}`],
    observations: [],
    logs: [],
  }
  const restores: (() => Promise<void>)[] = []
  const watches: ChannelWatch[] = []
  const logLine = (line: string): void => ctx.log(`[s${ID}] ${line}`)
  let swapWatch: SwapWatch | undefined
  try {
    const firstWatch = watchChannel({
      channel: requireChannel({ rig: ctx.rig(), step: 'precondition' }),
      log: logLine,
    })
    watches.push(firstWatch)
    await ensureServing(ctx)
    const ctl = await startControl(ctx)
    draft.commands.push(`started the control ticker ${CTL_LOG} detached (pid ${ctl})`)
    const bg = await startBackgroundShell(ctx)
    draft.commands.push(`asked the model for a background ticker ${BG_LOG} (pid ${bg})`)

    const pinA = await ctx.probes.box({ name: ctx.sandboxName(), logLines: 1 })
    draft.observations.push(
      observationOf({
        step: 'pin A',
        watch: firstWatch,
        provider: pinA.provider,
        stamps: stampsText(pinA),
        note: `serve pid ${pinA.servePid ?? '—'}`,
      }),
    )
    const sleepIndex = await transcriptLength(ctx.rig())
    await ctx.rig().submit(SLEEP_PROMPT)
    draft.commands.push(`submitted: ${SLEEP_PROMPT}`)
    const sleepSeen = await waitFor({
      what: 'the foreground hold running',
      within: SLEEP_SEEN_WITHIN_MS,
      every: POLL_MS,
      holds: async () => (await pgrepFirst({ ctx, pattern: 'tail -f /dev/nul[l]' })) !== null,
    })
    if (!sleepSeen)
      throw new ScenarioFailed({
        step: 'foreground hold',
        expected: 'timeout 150 tail -f /dev/null running in the box',
        observed: 'no such process within 90 s',
      })

    await ctx.rig().close()
    draft.commands.push(
      'closed the App (client detached) while the sleep runs',
      await applyMismatch({ ctx, mode, restores }),
    )
    const fromVersion = mode === EMismatch.ForgeStamp ? FORGED_STAMP : pinA.version
    const poller = startSwapWatch({
      probes: ctx.probes,
      name: ctx.sandboxName(),
      from: { pid: pinA.servePid, version: fromVersion },
      log: logLine,
    })
    swapWatch = poller
    const rig = await ctx.remount()
    draft.commands.push('remounted the App on the same thread')
    await waitFor({
      what: 'the resumed channel',
      within: CHANNEL_WITHIN_MS,
      holds: () => rig.channel() !== null,
    })
    const watch = watchChannel({ channel: requireChannel({ rig, step: 'remount' }), log: logLine })
    watches.push(watch)

    let doneBeforeSwap = false
    const swapped = await waitFor({
      what: 'the serve swap',
      within: SWAP_WITHIN_MS,
      every: SWAP_POLL_MS,
      holds: async () => {
        if (poller.swapped()) return true
        doneBeforeSwap ||= await saidAfter({ rig, word: 'DONE', afterIndex: sleepIndex })
        return false
      },
    })
    draft.observations.push(
      observationOf({ step: swapped ? 'swap observed' : 'swap not observed', watch }),
    )
    const done = await waitForReply({
      rig,
      word: 'DONE',
      afterIndex: sleepIndex,
      within: DONE_WITHIN_MS,
    })

    const swap = await poller.stop()
    swapWatch = undefined
    draft.observations.push(...observationsOf({ samples: swap.samples, step: 'swap poll' }))
    const pinB = await ctx.probes.box({ name: ctx.sandboxName(), logLines: SERVE_LOG_LINES })
    draft.observations.push(
      observationOf({
        step: 'pin B',
        watch,
        provider: pinB.provider,
        stamps: stampsText(pinB),
        note: `serve pid ${pinB.servePid ?? '—'}`,
      }),
    )
    const bgAlive = await aliveIn({ ctx, pid: bg })
    const growth = await growthOf(ctx)
    const ctlAlive = await aliveIn({ ctx, pid: ctl })
    const session = await serveSessionMatchesLive(ctx)
    const refusals = await stopRefusalsInServeLog(ctx)
    const processes = await ctx.probes
      .sh({ name: ctx.sandboxName(), script: 'ps -eo pid,args' })
      .catch(
        (error: unknown) => `ps failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    const resumedTurn = await turnStartedAfterBoot(ctx)
    draft.commands.push(`submitted after the swap: ${FOLLOW_UP_SEND}`)
    const followUp = await replyAfterSwap(rig)

    const criteria = createCriteria({ log: ctx.log })
    criteria.check({
      name: 'turn started after the new serve booted',
      expected: '≥ 1 serve.turn-started after the last serve.listening',
      observed: resumedTurn.observed,
      held: resumedTurn.held,
    })
    criteria.check({
      name: 'a send after the swap gets a reply',
      expected: 'a normal reply',
      observed: followUp.observed,
      held: followUp.held,
    })
    criteria.check({
      name: 'serve session id is the live session',
      expected: 'equal',
      observed: session.observed,
      held: session.held,
    })
    criteria.check({
      name: 'no stop refusal on any park',
      expected: '0 park-stop-failed / refusing-to-stop lines',
      observed: refusals.observed,
      held: refusals.held,
    })
    const pinChanged =
      mode === EMismatch.ForgeStamp
        ? pinB.version === pinA.version && pinB.version !== FORGED_STAMP
        : pinB.version !== pinA.version
    const pinExpected =
      mode === EMismatch.ForgeStamp
        ? `the client pin ${pinA.version ?? '—'} reinstalled over ${FORGED_STAMP}`
        : `different from pin A ${pinA.version ?? '—'}`
    criteria.check({
      name: 'pin B',
      expected: pinExpected,
      observed: pinB.version ?? 'none',
      held: pinB.version !== null && pinChanged,
    })
    criteria.check({
      name: 'pin B is a dev build',
      expected: `starts with ${DEV_PREFIX}`,
      observed: pinB.version ?? 'none',
      held: pinB.version?.startsWith(DEV_PREFIX) === true,
    })
    criteria.check({
      name: 'protocol',
      expected: String(REQUIRED_PROTOCOL),
      observed: String(pinB.protocol),
      held: pinB.protocol === REQUIRED_PROTOCOL,
    })
    criteria.check({
      name: 'serve pid',
      expected: `changed from ${pinA.servePid ?? '—'}`,
      observed: pinB.servePid ?? 'none',
      held: pinB.servePid !== null && pinB.servePid !== pinA.servePid,
    })
    const updating = updatingSourceOf({ phases: swap.phases, views: watch.views() })
    const sealed = matchingLines({
      text: swap.swapLines.join('\n'),
      pattern: DRAIN_SEALED_LINE,
    }).length
    criteria.check({
      name: 'updating seen',
      expected: 'updating in the box record or the client view',
      observed: `${updating} (record ${swap.phases.join(' → ') || 'none'}; drain-sealed lines ${sealed})`,
      held: updating !== 'neither',
    })
    criteria.check({
      name: 'client view showed updating',
      expected: 'updating in the resumed channel view timeline',
      observed: watch.views().join(' → ') || 'none',
      held: watch.views().includes('updating'),
    })
    const unconfirmed = rig.driverLines.find((line) => line.includes(UNCONFIRMED_DRAIN))
    criteria.check({
      name: 'drain confirmed',
      expected: `no "${UNCONFIRMED_DRAIN}" driver line`,
      observed: unconfirmed ?? 'none',
      held: unconfirmed === undefined,
    })
    criteria.check({
      name: 'record ends serving',
      expected: 'serving',
      observed: pinB.record?.phase ?? pinB.recordError ?? 'unread',
      held: pinB.record?.phase === 'serving',
    })
    criteria.check({
      name: 'paused turn resumed',
      expected: 'the swap, then DONE in the transcript (not before it)',
      observed: `swap ${swapped ? 'observed' : 'not observed'}, DONE ${done ? 'replied' : 'absent'}${doneBeforeSwap ? ', DONE already present before the swap' : ''}`,
      held: swapped && done && !doneBeforeSwap,
    })
    criteria.check({
      name: 'background shell alive',
      expected: `kill -0 ${bg} succeeds`,
      observed: bgAlive ? 'alive' : 'gone',
      held: bgAlive,
    })
    criteria.check({
      name: 'background log grows',
      expected: `${BG_LOG} grows across 6 s`,
      observed: growth === null ? 'unreadable' : `${growth.before} → ${growth.after} bytes`,
      held: growth !== null && growth.after > growth.before,
    })
    criteria.check({
      name: 'control process alive',
      expected: `kill -0 ${ctl} succeeds`,
      observed: ctlAlive ? 'alive' : 'gone',
      held: ctlAlive,
    })

    draft.logs.push(
      { label: 'criteria', text: criteria.text() },
      { label: 'ps -eo pid,args after the swap', text: processes },
      { label: 'view timeline (resumed channel)', text: watch.views().join(' → ') },
      { label: 'serve drain/rotation lines', text: swap.swapLines.join('\n') || '(none)' },
      {
        label: 'driver drain/rotation lines',
        text: rig.driverLines.filter((line) => DRIVER_SWAP_LINE.test(line)).join('\n') || '(none)',
      },
      {
        label: 'serve log tail after the swap',
        text: pinB.logTail ?? swap.lastLogTail ?? '(unavailable)',
      },
    )
    criteria.throwFirstFailure(draft)
    return { ...draft, verdict: EVerdict.Pass }
  } catch (failure) {
    throw withPartialEvidence({ failure, draft })
  } finally {
    await swapWatch?.stop().catch(() => undefined)
    for (const watch of watches) watch.stop()
    for (const restore of restores) await restore()
  }
}

export const swapScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runSwap }
