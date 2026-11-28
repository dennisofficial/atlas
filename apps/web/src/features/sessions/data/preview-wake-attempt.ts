import type { EPodPowerPhase } from '@dltech/atlas-core'

import { EPreviewWait } from '@/features/threads/data/preview-browser/preview-wake'

export enum EPreviewWakeOutcome {
  Visible = 'visible',
  Abandoned = 'abandoned',
}

export type PreviewWakeAttempt = {
  startedMs: number
  sessionId: string
  hostname: string
  phase: EPodPowerPhase | undefined
  wakeRequested: boolean
  startingPageSeen: boolean
}

export function previewWakeAttemptOf(args: {
  sessionId: string
  url: string
  phase: EPodPowerPhase | undefined
  wait: EPreviewWait
  wakeRequested: boolean
  now: number
}): PreviewWakeAttempt | undefined {
  if (args.wait === EPreviewWait.Awake || !URL.canParse(args.url)) return undefined
  return {
    startedMs: args.now,
    sessionId: args.sessionId,
    hostname: new URL(args.url).hostname,
    phase: args.phase,
    wakeRequested: args.wakeRequested,
    startingPageSeen: false,
  }
}

export function previewWakeProperties(args: {
  attempt: PreviewWakeAttempt
  outcome: EPreviewWakeOutcome
  now: number
}) {
  const { attempt, outcome } = args
  const elapsed = Math.max(0, args.now - attempt.startedMs)
  return {
    session_id: attempt.sessionId,
    preview_hostname: attempt.hostname,
    pod_phase: attempt.phase,
    wake_requested: attempt.wakeRequested,
    outcome,
    starting_page_seen: attempt.startingPageSeen,
    ...(outcome === EPreviewWakeOutcome.Visible
      ? { click_to_visible_ms: elapsed }
      : { elapsed_ms: elapsed }),
  }
}

export function previewWakeReport(args: {
  attempt: PreviewWakeAttempt
  url: string
  startingPage: boolean | undefined
  loaded: boolean | undefined
  visible: boolean
}): { attempt: PreviewWakeAttempt; outcome?: EPreviewWakeOutcome } {
  const { attempt } = args
  if (!URL.canParse(args.url) || new URL(args.url).hostname !== attempt.hostname) return { attempt }
  if (args.startingPage === true) return { attempt: { ...attempt, startingPageSeen: true } }
  if (args.startingPage !== false || args.loaded !== true || !args.visible) return { attempt }
  return { attempt, outcome: EPreviewWakeOutcome.Visible }
}
