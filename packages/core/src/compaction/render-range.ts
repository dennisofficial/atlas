import { agentLabel } from '../agents/label'
import { EReportKind } from '../agents/report'
import { laneNameOf } from '../context/envelope'
import { saidBy } from '../events/body'
import type { Event, EventOfType } from '../events/envelope'
import { reachesModel } from '../events/notice-stage'
import { EExecutionLocation } from '../execution/location'
import { elapsedPhrase } from '../shells/elapsed'
import { prEventContent } from '../assembly/rules/pr-event-block'
import { runEventContent } from '../assembly/rules/run-event-block'
import type { SummarisedType } from './disposition'

const PAYLOAD_CHARACTER_LIMIT = 600

const ELLIPSIS = '…'

const clipped = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}${ELLIPSIS}`

function locationPhrase(location: EExecutionLocation): string {
  if (location === EExecutionLocation.Docker) return 'a Docker container'
  if (location === EExecutionLocation.Cloud) return 'a cloud sandbox'
  return 'the host'
}

function jsonOrDescription(value: unknown, limit: number): string {
  if (typeof value === 'string') return clipped(value, limit)

  try {
    return clipped(JSON.stringify(value) ?? String(value), limit)
  } catch {
    return `(unrenderable ${typeof value})`
  }
}

type LineArgs<TType extends SummarisedType> = { event: EventOfType<TType>; limit: number }

const assistantLine = ({ event, limit }: LineArgs<'assistant-said'>): string | undefined => {
  const spoken = event.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
  return spoken === '' ? undefined : `Atlas: ${clipped(spoken, limit)}`
}

const toolResultLine = ({ event, limit }: LineArgs<'tool-result'>): string => {
  if (event.error !== undefined)
    return `${event.name} failed: ${clipped(event.error.message, limit)}`
  return `${event.name} returned ${jsonOrDescription(event.modelText ?? event.output, limit)}`
}

const SUMMARISED_LINES: {
  [TType in SummarisedType]: (args: LineArgs<TType>) => string | undefined
} = {
  'user-said': ({ event, limit }) => saidLine(event, limit),
  'assistant-said': assistantLine,
  'tool-called': ({ event, limit }) =>
    `Atlas called ${event.name} with ${jsonOrDescription(event.input, limit)}`,
  'tool-result': toolResultLine,
  'tool-denied': ({ event, limit }) => `${event.name} was denied: ${clipped(event.reason, limit)}`,
  'history-compacted': ({ event }) => `Summary of the conversation before this: ${event.summary}`,
  'agent-ended': ({ event, limit }) =>
    `Sub-agent (${event.agentType}, ${event.intent}) ${event.status}: ${clipped(event.prose, limit)}`,
  'agent-reported': ({ event, limit }) =>
    `Agent ${event.agentId} (${agentLabel(event)}) reported ${event.kind ?? EReportKind.Done}: ${clipped(event.prose, limit)}`,
  'agent-restarted': ({ event }) =>
    `Sub-agent (${event.agentType}, ${event.intent}) was restarted (via ${event.via})`,
  'background-shell-ended': ({ event, limit }) =>
    `Background shell "${event.command}" ${event.status}: ${clipped(event.output, limit)}`,
  'background-shell-still-running': ({ event }) =>
    `Background shell "${event.command}" still running after ${elapsedPhrase(event.runningForMs)}`,
  'background-shell-matched': ({ event, limit }) =>
    `Background shell "${event.command}" matched ${event.pattern}: ${clipped(event.lines, limit)}`,
  'background-shell-awaiting-input': ({ event, limit }) =>
    `Background shell "${event.command}" is waiting for input: ${clipped(event.output, limit)}`,
  'service-ended': ({ event, limit }) =>
    `Service "${event.command}" ${event.status}: ${clipped(event.tail, limit)}`,
  'pr-event': ({ event }) => prEventContent(event),
  'run-event': ({ event }) => runEventContent(event),
  nudge: ({ event, limit }) => `Harness nudge: ${clipped(event.text, limit)}`,
  'sandbox-setup-reported': ({ event }) => `Atlas sandbox setup: ${event.text}`,
  parked: ({ event }) => `Atlas parked this session (${event.reason})`,
}

type KeptLineType =
  | 'location-changed'
  | 'worktree-entered'
  | 'worktree-exited'
  | 'directory-changed'

type KeptLineArgs<TType extends KeptLineType> = { event: EventOfType<TType>; limit: number }

const KEPT_LINES: { [TType in KeptLineType]: (args: KeptLineArgs<TType>) => string } = {
  'location-changed': ({ event }) => {
    const base = `Atlas moved this conversation's processing to ${locationPhrase(event.to)} — earlier tool results came from ${locationPhrase(event.from)}`
    return event.cwd === undefined ? base : `${base} — the working directory is now ${event.cwd}`
  },
  'worktree-entered': ({ event }) => `Atlas entered worktree ${event.path} (${event.branch})`,
  'worktree-exited': ({ event }) => `Atlas left worktree ${event.path} (${event.action})`,
  'directory-changed': ({ event }) => `Atlas moved the project directory to ${event.path}`,
}

type LineType = SummarisedType | KeptLineType

type LinedEvents = { [TType in LineType]: EventOfType<TType> }

type LineTable = {
  [TType in LineType]: (args: { event: LinedEvents[TType]; limit: number }) => string | undefined
}

const LINES: LineTable = { ...SUMMARISED_LINES, ...KEPT_LINES }

const isLined = (event: Event): event is LinedEvents[LineType] => Object.hasOwn(LINES, event.type)

function render<TType extends LineType>(args: {
  type: TType
  event: LinedEvents[TType]
  limit: number
}): string | undefined {
  return LINES[args.type]({ event: args.event, limit: args.limit })
}

function lineOf(event: Event, payloadLimit: number): string | undefined {
  if (!reachesModel(event) || !isLined(event)) return undefined
  return render({ type: event.type, event, limit: payloadLimit })
}

function saidLine(event: EventOfType<'user-said'>, limit: number): string {
  const speaker = laneNameOf({ origin: saidBy(event), sender: event.sender?.session }).heading
  return `${speaker}: ${clipped(event.text, limit)}`
}

const isProse = (event: Event): boolean =>
  event.type === 'history-compacted' ||
  event.type === 'user-said' ||
  event.type === 'assistant-said'

export function transcriptOfRange({
  events,
  fromSeq = 0,
  throughSeq,
  proseOnly = false,
  payloadLimit = PAYLOAD_CHARACTER_LIMIT,
}: {
  events: readonly Event[]
  fromSeq?: number | undefined
  throughSeq: number
  proseOnly?: boolean | undefined
  payloadLimit?: number | undefined
}): string {
  return events
    .filter((event) => event.seq >= fromSeq && event.seq <= throughSeq)
    .filter((event) => !proseOnly || isProse(event))
    .flatMap((event) => {
      const line = lineOf(event, payloadLimit)
      return line === undefined ? [] : [line]
    })
    .join('\n')
}
