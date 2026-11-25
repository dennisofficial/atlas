import {
  type CallId,
  type CodeQualityReviewedBody,
  type Event,
  type EventOfType,
} from '@dltech/atlas-core'

import { qualityReviewsByCall } from './quality-reviews-by-call'
import {
  attachmentsOf,
  brokenBy,
  NOTHING_ATTACHED,
  type ContextAttachment,
} from './tool-attachments'
import { firstPictureIn, type ToolPicture } from './tool-picture'

export { attachmentsOf, type ContextAttachment }
export { firstPictureIn, type ToolPicture }

export enum ECallState {
  Pending = 'pending',
  AwaitingApproval = 'awaiting-approval',
  Ok = 'ok',
  Failed = 'failed',
  Denied = 'denied',
}

export type ToolCall = {
  callId: CallId
  name: string
  input: unknown
  output: unknown
  modelText: string
  image?: ToolPicture | undefined
  state: ECallState
  /** The error or denial reason, when there is one. */
  note: string | null
  at: string | null
  settledAt: string | null
  /**
   * What a still-running call has printed so far, pushed live from the tool rather than read off
   * the result. Absent once the call settles — the durable output takes over.
   */
  liveOutput?: string | undefined
  attachments: readonly ContextAttachment[]
  qualityReviews?: readonly CodeQualityReviewedBody[] | undefined
}

export type ToolRun = { key: string; openedBy: CallId; calls: readonly ToolCall[] }

export type LiveToolCall = {
  callId: CallId
  name: string
  input: unknown
  /** When the call opened, stamped as the first chunk of it arrived — the durable log lags behind. */
  at: string | null
  precededByBlocks: number
}

export type LiveToolRun = { run: ToolRun; precededByBlocks: number }

const OPEN: readonly ECallState[] = [ECallState.Pending, ECallState.AwaitingApproval]

export const settled = (call: ToolCall): boolean => !OPEN.includes(call.state)

export const succeeded = (call: ToolCall): boolean =>
  call.state === ECallState.Ok || OPEN.includes(call.state)

type Settle = {
  at: string
  state: ECallState
  output: unknown
  modelText: string
  note: string | null
  image: ToolCall['image']
  qualityReviews: readonly CodeQualityReviewedBody[]
}

function awaitingApprovalIn(events: readonly Event[]): ReadonlyMap<CallId, string> {
  const asked = new Map<CallId, string>()

  for (const event of events) {
    if (event.type === 'approval-requested') asked.set(event.callId, event.reason)
    if (event.type === 'approval-answered') asked.delete(event.callId)
  }

  return asked
}

function settlesOf(events: readonly Event[]): Map<CallId, Settle> {
  const settles = new Map<CallId, Settle>()

  for (const event of events) {
    if (event.type === 'tool-result') {
      settles.set(event.callId, {
        at: event.at,
        state: event.error === undefined ? ECallState.Ok : ECallState.Failed,
        output: event.output,
        modelText: event.modelText ?? '',
        note: event.error?.message ?? null,
        image: firstPictureIn({ parts: event.modelParts }),
        qualityReviews: event.qualityReviews ?? [],
      })
    }

    if (event.type === 'tool-denied') {
      settles.set(event.callId, {
        at: event.at,
        state: ECallState.Denied,
        output: undefined,
        modelText: '',
        note: event.reason,
        image: undefined,
        qualityReviews: [],
      })
    }
  }

  return settles
}

type CallSeed = { callId: CallId; name: string; input: unknown; at: string | null }

const seedOf = (event: EventOfType<'tool-called'>): CallSeed => ({
  callId: event.callId,
  name: event.name,
  input: event.input,
  at: event.at,
})

function callOf(args: {
  seed: CallSeed
  settle: Settle | undefined
  awaiting: string | undefined
  attachments: readonly ContextAttachment[]
  recordedReviews: readonly CodeQualityReviewedBody[]
}): ToolCall {
  const { seed, settle, awaiting } = args
  const unsettled = awaiting === undefined ? ECallState.Pending : ECallState.AwaitingApproval

  return {
    callId: seed.callId,
    name: seed.name,
    input: seed.input,
    output: settle?.output,
    modelText: settle?.modelText ?? '',
    state: settle?.state ?? unsettled,
    note: settle?.note ?? awaiting ?? null,
    image: settle?.image,
    at: seed.at,
    settledAt: settle?.at ?? null,
    attachments: args.attachments,
    qualityReviews: reviewsOf({ settle, recorded: args.recordedReviews }),
  }
}

const reviewsOf = (args: {
  settle: Settle | undefined
  recorded: readonly CodeQualityReviewedBody[]
}): readonly CodeQualityReviewedBody[] =>
  args.settle?.state === ECallState.Denied
    ? []
    : [...(args.settle?.qualityReviews ?? []), ...args.recorded]

function runOf(args: {
  seeds: readonly CallSeed[]
  settles: ReadonlyMap<CallId, Settle>
  awaiting: ReadonlyMap<CallId, string>
  attachments: ReadonlyMap<CallId, readonly ContextAttachment[]>
  reviews: ReadonlyMap<CallId, readonly CodeQualityReviewedBody[]>
}): ToolRun {
  const first = args.seeds[0]
  if (first === undefined) throw new Error('a tool run needs at least one call')

  return {
    key: `tools:${first.callId}`,
    openedBy: first.callId,
    calls: args.seeds.map((seed) =>
      callOf({
        seed,
        settle: args.settles.get(seed.callId),
        awaiting: args.awaiting.get(seed.callId),
        attachments: args.attachments.get(seed.callId) ?? NOTHING_ATTACHED,
        recordedReviews: args.reviews.get(seed.callId) ?? NO_REVIEWS,
      }),
    ),
  }
}

export function toolRuns(events: readonly Event[]): ToolRun[] {
  const settles = settlesOf(events)
  const awaiting = awaitingApprovalIn(events)
  const attachments = attachmentsOf(events)
  const reviews = qualityReviewsByCall(events)
  const runs: CallSeed[][] = []
  let open = false

  for (const event of events) {
    if (brokenBy(event)) {
      open = false
      continue
    }
    if (event.type !== 'tool-called') continue

    if (open) runs.at(-1)?.push(seedOf(event))
    else runs.push([seedOf(event)])
    open = true
  }

  return runs.map((seeds) => runOf({ seeds, settles, awaiting, attachments, reviews }))
}

const NO_SETTLES: ReadonlyMap<CallId, Settle> = new Map()

const NONE_AWAITING: ReadonlyMap<CallId, string> = new Map()

const NO_ATTACHMENTS: ReadonlyMap<CallId, readonly ContextAttachment[]> = new Map()

const NO_REVIEWS: readonly CodeQualityReviewedBody[] = Object.freeze([])

const NO_RECORDED_REVIEWS: ReadonlyMap<CallId, readonly CodeQualityReviewedBody[]> = new Map()

export function liveToolRuns(calls: readonly LiveToolCall[]): LiveToolRun[] {
  const runs: { precededByBlocks: number; seeds: CallSeed[] }[] = []

  for (const call of calls) {
    const seed: CallSeed = { callId: call.callId, name: call.name, input: call.input, at: call.at }
    const open = runs.at(-1)

    if (open !== undefined && open.precededByBlocks === call.precededByBlocks) open.seeds.push(seed)
    else runs.push({ precededByBlocks: call.precededByBlocks, seeds: [seed] })
  }

  return runs.map((run) => ({
    run: runOf({
      seeds: run.seeds,
      settles: NO_SETTLES,
      awaiting: NONE_AWAITING,
      attachments: NO_ATTACHMENTS,
      reviews: NO_RECORDED_REVIEWS,
    }),
    precededByBlocks: run.precededByBlocks,
  }))
}
