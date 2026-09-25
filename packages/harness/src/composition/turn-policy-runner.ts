import {
  autoCompactAfterTurn,
  contextPressure,
  EAutoCompact,
  ENoticeTone,
  NOTICE_MS,
  NOTICE_WARN_MS,
  type EventLogPort,
  type ModelPort,
  type NoticePort,
  type ThreadId,
  contextWindowOf,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'
import {
  ESuppress,
  type TurnPolicy,
  type TurnPolicyListener,
  type TurnPolicyState,
} from '../loop/turn-policy'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { PendingSaid } from '../pending'
import type { RewindMachineryPort } from '../store/rewind-machinery'
import type { ThreadStorePort } from '../store/thread-store'

import { compactTurn, ECompaction, type Summariser } from './compact-turn'
import { EUndo, undoTurn } from './undo-turn'
import type { UsageTracker } from './usage-tracker'

const COMPACTION_CRASHED = 'compacting the history did not finish, so nothing was changed'

const compactionNotice = (usedPercent: number): string =>
  `The window reached ${usedPercent}% — summarising the earlier turns so the conversation fits again.`

/**
 * The between-turns rules every session kind settles by: an interrupted turn that committed
 * nothing is taken back, and a window full past the operator's threshold compacts itself. They
 * used to live in the TUI's React layer, so serve sessions settled interrupted turns differently
 * and never compacted. The runner decorates the same runner the surface calls, so the policy also
 * applies to turns no surface started (a wake turn, a factory-driven one).
 *
 * What stays surface-side: the keystroke that suppresses the undo (a move interrupts on the
 * operator's behalf and keeps the message committed), the retry/resume/resume-fresh buttons, and
 * how a compaction in flight is drawn. Both surfaces read the same transitions — the TUI off
 * `state()`, serve off the NoticePort (its log).
 */
export function createTurnPolicyRunner(args: {
  inner: TurnRunner
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  machinery: RewindMachineryPort
  model: ModelPort
  summarise: Summariser
  usage: UsageTracker
  atPercent: () => number
  notice: NoticePort
  readClock: () => number
}): TurnRunner & TurnPolicy {
  const { inner, log, threads, agents, machinery, model, summarise, usage, atPercent, notice, readClock } =
    args

  let state: TurnPolicyState = { type: 'idle' }
  const listeners = new Set<TurnPolicyListener>()
  let compaction: AbortController | null = null
  let suppression = ESuppress.None
  let takenBack: PendingSaid | null = null

  const emit = (next: TurnPolicyState): void => {
    state = next
    for (const listener of [...listeners]) listener(next)
  }

  const warn = ({ key, text }: { key: string; text: string }): void =>
    notice.notify({ key, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text })

  const windowOf = (): number => contextWindowOf(model)

  const compactIfFull = async (args2: {
    threadId: ThreadId
    outcome: TurnOutcome
  }): Promise<void> => {
    const { threadId, outcome } = args2
    const window = windowOf()
    const used = await usage.usageOf({ threadId, outcome })
    const decision = autoCompactAfterTurn({ used, window, atPercent: atPercent() })
    if (decision === EAutoCompact.Hold) return

    const controller = new AbortController()
    compaction = controller
    emit({ type: 'compacting', startedAt: readClock() })
    notice.notify({
      key: 'auto-compaction',
      tone: ENoticeTone.Info,
      ttlMs: NOTICE_WARN_MS,
      text: compactionNotice(contextPressure({ used, window }).percent),
    })

    try {
      const result = await compactTurn({
        log,
        threads,
        agents,
        threadId,
        summarise,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (result.type === ECompaction.Refused) {
        warn({ key: 'auto-compaction', text: result.reason })
        return
      }
      if (result.type === ECompaction.Compacted) {
        notice.notify({
          key: 'auto-compaction',
          tone: ENoticeTone.Done,
          ttlMs: NOTICE_MS,
          text: `Summarised ${result.replaced} earlier events so the conversation fits the window again.`,
        })
      }
    } catch {
      if (!controller.signal.aborted) warn({ key: 'auto-compaction', text: COMPACTION_CRASHED })
    } finally {
      compaction = null
      emit({ type: 'idle' })
    }
  }

  const settleUndo = async ({ threadId }: { threadId: ThreadId }): Promise<void> => {
    const undone = await undoTurn({ log, threads, machinery, threadId })
    if (undone.type === EUndo.Nothing) return
    if (undone.type === EUndo.Refused) {
      warn({ key: 'turn-undo', text: undone.reason })
      return
    }
    takenBack = undone.said
    notice.notify({
      key: 'turn-undo',
      tone: ENoticeTone.Done,
      ttlMs: NOTICE_MS,
      text: 'The interrupted turn was taken back — what you said is back in the composer.',
    })
  }

  return {
    say: ({ threadId, text, signal }) =>
      inner.say({ threadId, text, ...(signal === undefined ? {} : { signal }) }),
    runTurn: ({ threadId, signal }) =>
      inner.runTurn({ threadId, ...(signal === undefined ? {} : { signal }) }),
    resume: ({ threadId, signal }) =>
      inner.resume({ threadId, ...(signal === undefined ? {} : { signal }) }),

    async onOutcome({ threadId, outcome }) {
      if (
        outcome.status === ETurnStatus.Interrupted &&
        !outcome.committed &&
        suppression !== ESuppress.UndoOnce
      ) {
        await settleUndo({ threadId })
      }
      suppression = ESuppress.None
      await compactIfFull({ threadId, outcome })
    },

    async onCrashed({ threadId }) {
      void threadId
      suppression = ESuppress.None
      compaction?.abort()
    },

    state: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    cancelCompaction() {
      const running = compaction
      if (running === null) return false
      running.abort()
      return true
    },

    suppress(what) {
      suppression = what
    },

    undone() {
      const said = takenBack
      takenBack = null
      return said
    },
  }
}
