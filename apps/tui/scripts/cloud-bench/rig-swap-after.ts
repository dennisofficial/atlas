import { SERVE_LOG_PATH } from '@dltech/atlas-wire'

import type { ScenarioContext } from './rig-context'
import type { RigApp } from './rig-mount'
import { waitFor } from './rig-observer'
import { assistantSaid, transcriptOf } from './rig-transcript'

const FOLLOW_UP_WORD = 'AFTERSWAP'
const FOLLOW_UP_PROMPT = `Reply with the single word ${FOLLOW_UP_WORD}.`
const FOLLOW_UP_WITHIN_MS = 3 * 60_000
const FOLLOW_UP_EVERY_MS = 3_000
const BOOT_EVENT = 'serve.listening'
const TURN_STARTED_EVENT = 'serve.turn-started'

export type AfterSwapCheck = { held: boolean; observed: string }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function turnStartedAfterBoot(ctx: ScenarioContext): Promise<AfterSwapCheck> {
  const script = `grep -nE '"event":"(${BOOT_EVENT}|${TURN_STARTED_EVENT})"' ${SERVE_LOG_PATH} | tail -n 40`
  try {
    const lines = (await ctx.probes.sh({ name: ctx.sandboxName(), script })).split('\n').filter((line) => line.length > 0)
    const lastBoot = lines.findLastIndex((line) => line.includes(BOOT_EVENT))
    if (lastBoot < 0) return { held: false, observed: `no ${BOOT_EVENT} line in the serve log` }
    const started = lines.slice(lastBoot + 1).filter((line) => line.includes(TURN_STARTED_EVENT)).length
    return { held: started > 0, observed: `${started} ${TURN_STARTED_EVENT} line(s) after the last ${BOOT_EVENT}` }
  } catch (error) {
    return { held: false, observed: `probe failed: ${messageOf(error)}` }
  }
}

export async function replyAfterSwap(rig: RigApp): Promise<AfterSwapCheck> {
  const before = (await transcriptOf({ rig }).catch(() => [])).length
  await rig.submit(FOLLOW_UP_PROMPT)
  const replied = await waitFor({
    what: `a ${FOLLOW_UP_WORD} reply after the swap`,
    within: FOLLOW_UP_WITHIN_MS,
    every: FOLLOW_UP_EVERY_MS,
    holds: async () =>
      assistantSaid({ events: await transcriptOf({ rig }).catch(() => []), word: FOLLOW_UP_WORD, afterIndex: before - 1 }),
  })
  return {
    held: replied,
    observed: replied ? `${FOLLOW_UP_WORD} replied` : `no ${FOLLOW_UP_WORD} reply within ${FOLLOW_UP_WITHIN_MS / 60_000} min`,
  }
}

export const FOLLOW_UP_SEND = FOLLOW_UP_PROMPT
