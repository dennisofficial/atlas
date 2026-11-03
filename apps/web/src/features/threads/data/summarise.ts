import {
  ECompactionAnchor,
  summariseReach,
  type SummarisePoint,
  type SummariseReach,
} from '@dltech/atlas-core'
import {
  EClientRequest,
  type EClientRequest as ClientRequestOp,
} from '@dltech/atlas-client/channel'
import { compactionReplySchema, EWireCompactionAnchor } from '@dltech/atlas-wire/web'

export const SUMMARISE_WAITS_FOR_TURN =
  'Summarising has to wait for this turn — try again when it settles'
export const SUMMARISE_NEEDS_SANDBOX = 'Summarising needs the sandbox — try again once it is live'
export const SUMMARISE_ALREADY_RUNNING = 'A summary is already being written'
export const NOTHING_TO_SUMMARISE = 'Nothing to summarise'
export const SUMMARISING = 'Summarising…'

export enum ESummariseDecision {
  Warn = 'warn',
  Confirm = 'confirm',
  Ignore = 'ignore',
}

export type SummariseDecision =
  | { kind: ESummariseDecision.Warn; message: string }
  | { kind: ESummariseDecision.Confirm; pick: SummariseReach }
  | { kind: ESummariseDecision.Ignore }

export function decideSummarise(args: {
  points: ReadonlyMap<string, SummarisePoint>
  eventId: string
  anchor: ECompactionAnchor
  live: boolean
  working: boolean
  running: boolean
}): SummariseDecision {
  if (args.running) return { kind: ESummariseDecision.Warn, message: SUMMARISE_ALREADY_RUNNING }
  if (args.working) return { kind: ESummariseDecision.Warn, message: SUMMARISE_WAITS_FOR_TURN }
  if (!args.live) return { kind: ESummariseDecision.Warn, message: SUMMARISE_NEEDS_SANDBOX }
  const point = args.points.get(args.eventId)
  const pick = point === undefined ? null : summariseReach({ point, anchor: args.anchor })
  if (pick === null) return { kind: ESummariseDecision.Ignore }
  return { kind: ESummariseDecision.Confirm, pick }
}

const plural = (args: { count: number; noun: string }): string =>
  `${args.count} ${args.noun}${args.count === 1 ? '' : 's'}`

export type SummariseCopy = { title: string; description: string }

export function summariseCopyOf(pick: SummariseReach): SummariseCopy {
  const gone =
    'Their rows leave the transcript and can no longer be rewound to. Files are left as they are.'
  if (pick.anchor === ECompactionAnchor.Prefix) {
    return {
      title: 'Summarise everything before this message?',
      description: `The ${plural({ count: pick.messages, noun: 'earlier message' })} and every reply become one summary. ${gone}`,
    }
  }
  return {
    title: 'Summarise from this message on?',
    description: `This message, ${plural({ count: pick.messages - 1, noun: 'later message' })} and every reply become one summary. ${gone}`,
  }
}

const anchorToWire = (anchor: ECompactionAnchor): EWireCompactionAnchor =>
  anchor === ECompactionAnchor.Suffix ? EWireCompactionAnchor.Suffix : EWireCompactionAnchor.Prefix

export async function requestSummarise(args: {
  request: (call: { op: ClientRequestOp; params: unknown }) => Promise<unknown>
  threadId: string
  operationId: string
  pick: SummariseReach
}): Promise<string> {
  const reply = compactionReplySchema.parse(
    await args.request({
      op: EClientRequest.SummariseHistory,
      params: {
        threadId: args.threadId,
        operationId: args.operationId,
        anchor: anchorToWire(args.pick.anchor),
        seq: args.pick.seq,
      },
    }),
  )
  if (reply.type === 'refused') throw new Error(reply.reason)
  if (reply.type === 'nothing') return NOTHING_TO_SUMMARISE
  return `Summarised ${plural({ count: args.pick.messages, noun: 'message' })}`
}
