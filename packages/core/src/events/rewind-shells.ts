import type { EventType } from './body'
import type { DraftOfType, Event, EventOfType } from './envelope'
import type { CallId, RunId } from './ids'

export type ShellNoticeType = Extract<EventType, `background-shell-${string}`>

export type SurvivingShellNotice = {
  runId: RunId
  draft: DraftOfType<ShellNoticeType>
}

export type RewindShellPlan = {
  cutShellIds: readonly string[]
  reappend: readonly SurvivingShellNotice[]
}

const isShellNotice = (event: Event): event is EventOfType<ShellNoticeType> =>
  event.type.startsWith('background-shell-')

const runsInBackground = (input: unknown): boolean =>
  typeof input === 'object' &&
  input !== null &&
  (input as { runInBackground?: unknown }).runInBackground === true

const shellIdOf = (output: unknown): string | undefined => {
  if (typeof output !== 'object' || output === null) return undefined
  const shellId = (output as { shellId?: unknown }).shellId
  return typeof shellId === 'string' ? shellId : undefined
}

const toNotice = (event: EventOfType<ShellNoticeType>): SurvivingShellNotice => {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return { runId, draft }
}

/**
 * A rewind owns only what it removes: a shell is cut when its background start sits above the cut,
 * and a start the log no longer holds — summarised away, or inherited — means keep. That is also
 * why a shell_output read above the cut condemns nothing: only a runInBackground call paired with
 * the result carrying the shellId is a start.
 */
export function rewindShellPlan({
  events,
  toSeq,
}: {
  events: readonly Event[]
  toSeq: number
}): RewindShellPlan {
  const above = events.filter((event) => event.seq > toSeq)

  const backgroundStarts = new Set<CallId>()
  for (const event of above) {
    if (event.type === 'tool-called' && runsInBackground(event.input)) {
      backgroundStarts.add(event.callId)
    }
  }

  const cutShellIds = new Set<string>()
  for (const event of above) {
    if (event.type !== 'tool-result' || !backgroundStarts.has(event.callId)) continue
    const shellId = shellIdOf(event.output)
    if (shellId !== undefined) cutShellIds.add(shellId)
  }

  const reappend = above
    .filter(
      (event): event is EventOfType<ShellNoticeType> =>
        isShellNotice(event) && !cutShellIds.has(event.shellId),
    )
    .map(toNotice)

  return { cutShellIds: [...cutShellIds], reappend }
}
