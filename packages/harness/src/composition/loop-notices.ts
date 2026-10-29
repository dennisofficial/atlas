import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import type { TurnDeps } from '../loop/run-turn'

export function loopNotices(args: {
  notice: NoticePort
}): Pick<TurnDeps, 'onLoopWatch' | 'onLoopWatchCut' | 'onLoopStop' | 'onLoopCut'> {
  const { notice } = args
  return {
    onLoopWatch: () =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: 'the watchdog judged this turn to be looping and could not cut it — the agent was nudged to break the pattern, and the turn will stop if it keeps going',
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopWatchCut: ({ steps }) =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: `the watchdog cut ${steps} steps from this turn — the decision model judged them a loop and loops left in context invite more looping. If the pattern re-forms, the turn will be stopped`,
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopStop: () =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: 'the watchdog stopped this turn — it still looked stuck after a warning, so the turn ended instead of spinning. Send a message to pick it back up',
        ttlMs: NOTICE_WARN_MS,
      }),
    onLoopCut: (cut) =>
      notice.notify({
        tone: ENoticeTone.Warn,
        text: `cut a runaway loop: ${cut.names.join(', ')} returned identical results ${cut.repeats} times in a row, so the turn was rewound to before the repetition`,
        ttlMs: NOTICE_WARN_MS,
      }),
  }
}
