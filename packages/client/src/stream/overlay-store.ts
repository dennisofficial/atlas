import type { V2Event } from '@dltech/atlas-core'
import type { EStreamBlockKind, StreamServerMessage, StreamStepKey } from '@dltech/atlas-protocol'

const MAX_REMEMBERED_RUNS = 16

export type OverlayBlock = { block: string; kind: EStreamBlockKind; text: string }

export type OpenOverlay = {
  key: StreamStepKey
  blocks: readonly OverlayBlock[]
  openedAt: number
  ended: boolean
  settleAt: number | undefined
}

export type OverlayState = {
  open: OpenOverlay | undefined
  highWater: Readonly<Record<string, StreamStepKey>>
  resnapPending: boolean
}

export type OverlayMessage = Extract<
  StreamServerMessage,
  { type: 'overlay' | 'delta' | 'overlay-clear' | 'frame' }
>

export type OverlayStep = { state: OverlayState; needsResnap: boolean }

export const EMPTY_OVERLAY_STATE: OverlayState = {
  open: undefined,
  highWater: {},
  resnapPending: false,
}

const sameStep = (args: { left: StreamStepKey; right: StreamStepKey }): boolean =>
  args.left.runId === args.right.runId &&
  args.left.step === args.right.step &&
  args.left.attempt === args.right.attempt

const isLaterInRun = (args: { candidate: StreamStepKey; current: StreamStepKey }): boolean => {
  const { candidate, current } = args
  if (candidate.step !== current.step) return candidate.step > current.step
  return candidate.attempt > current.attempt
}

const isEarlierInOpenRun = (args: { key: StreamStepKey; open: StreamStepKey }): boolean =>
  args.key.runId === args.open.runId &&
  !sameStep({ left: args.key, right: args.open }) &&
  !isLaterInRun({ candidate: args.key, current: args.open })

const isRetired = (args: { state: OverlayState; key: StreamStepKey }): boolean => {
  const mark = args.state.highWater[args.key.runId]
  return mark !== undefined && !isLaterInRun({ candidate: args.key, current: mark })
}

const remember = (args: {
  highWater: Readonly<Record<string, StreamStepKey>>
  mark: StreamStepKey
}): Record<string, StreamStepKey> => {
  const { [args.mark.runId]: previous, ...others } = args.highWater
  const higher =
    previous !== undefined && !isLaterInRun({ candidate: args.mark, current: previous })
  const entries = Object.entries({ ...others, [args.mark.runId]: higher ? previous : args.mark })
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_RUNS)) as Record<string, StreamStepKey>
}

const retireStep = (args: { state: OverlayState; key: StreamStepKey }): OverlayState => ({
  ...args.state,
  highWater: remember({ highWater: args.state.highWater, mark: args.key }),
})

const retireRun = (args: { state: OverlayState; runId: string }): OverlayState =>
  retireStep({
    state: args.state,
    key: { runId: args.runId, step: Number.POSITIVE_INFINITY, attempt: Number.POSITIVE_INFINITY },
  })

export const closeOverlay = (state: OverlayState): OverlayState =>
  state.open === undefined
    ? state
    : { ...retireStep({ state, key: state.open.key }), open: undefined }

const noChange = (state: OverlayState): OverlayStep => ({ state, needsResnap: false })

const gapIn = (state: OverlayState): OverlayStep => ({
  state: { ...state, resnapPending: true },
  needsResnap: !state.resnapPending,
})

const openOverlay = (args: {
  state: OverlayState
  key: StreamStepKey
  blocks: readonly OverlayBlock[]
  cursorSeq: number
}): OverlayState => {
  const { state, key } = args
  const { open } = state
  const same = open !== undefined && sameStep({ left: open.key, right: key })
  const openedAt = same ? open.openedAt : args.cursorSeq
  const superseded =
    open === undefined || same
      ? state
      : open.key.runId !== key.runId
        ? retireRun({ state, runId: open.key.runId })
        : retireStep({ state, key: open.key })
  return {
    ...superseded,
    open: { key, blocks: args.blocks, openedAt, ended: false, settleAt: undefined },
    resnapPending: false,
  }
}

const applyOverlay = (args: {
  state: OverlayState
  message: Extract<OverlayMessage, { type: 'overlay' }>
  cursorSeq: number
}): OverlayStep => {
  const { state, message, cursorSeq } = args
  if (isRetired({ state, key: message.key })) return noChange(state)
  if (state.open !== undefined && isEarlierInOpenRun({ key: message.key, open: state.open.key })) {
    return noChange(state)
  }
  const blocks = message.blocks.map(({ block, kind, text }) => ({ block, kind, text }))
  return noChange(openOverlay({ state, key: message.key, blocks, cursorSeq }))
}

const appendDelta = (args: {
  open: OpenOverlay
  message: Extract<OverlayMessage, { type: 'delta' }>
}): OpenOverlay | 'gap' | 'have' => {
  const { open, message } = args
  const existing = open.blocks.find((block) => block.block === message.block)
  const have = existing?.text.length ?? 0
  if (message.from + message.text.length <= have) return 'have'
  if (message.from > have) return 'gap'
  const text = message.text.slice(have - message.from)
  const blocks =
    existing === undefined
      ? [...open.blocks, { block: message.block, kind: message.kind, text }]
      : open.blocks.map((block) =>
          block === existing ? { ...block, text: block.text + text } : block,
        )
  return { ...open, blocks }
}

const applyDelta = (args: {
  state: OverlayState
  message: Extract<OverlayMessage, { type: 'delta' }>
}): OverlayStep => {
  const { state, message } = args
  const { open } = state
  if (isRetired({ state, key: message.key })) return noChange(state)
  if (open === undefined || !sameStep({ left: open.key, right: message.key })) {
    if (open !== undefined && isEarlierInOpenRun({ key: message.key, open: open.key })) {
      return noChange(state)
    }
    return gapIn(state)
  }
  const next = appendDelta({ open, message })
  if (next === 'have') return noChange(state)
  if (next === 'gap') return gapIn(state)
  return noChange({ ...state, open: next })
}

export const endOverlay = (args: {
  state: OverlayState
  settleAt: number | undefined
}): OverlayState => {
  const { state, settleAt } = args
  const { open } = state
  if (open === undefined) return state
  const retired = retireStep({ state, key: open.key })
  return { ...retired, open: { ...open, ended: true, settleAt: settleAt ?? open.settleAt } }
}

export const endOverlayForView = (args: { state: OverlayState; at: number }): OverlayState => {
  const { state, at } = args
  if (state.open === undefined || at <= state.open.openedAt) return state
  return endOverlay({ state, settleAt: at })
}

export const settleOverlay = (args: { state: OverlayState; cursorSeq: number }): OverlayState => {
  const { state, cursorSeq } = args
  const settleAt = state.open?.settleAt
  if (settleAt === undefined || cursorSeq < settleAt) return state
  return closeOverlay(state)
}

const applyStepEnd = (args: { state: OverlayState; key: StreamStepKey }): OverlayStep => {
  const { state, key } = args
  const retired = retireStep({ state, key })
  const ends = state.open !== undefined && sameStep({ left: state.open.key, right: key })
  const next = ends ? endOverlay({ state: retired, settleAt: undefined }) : retired
  return noChange({ ...next, resnapPending: false })
}

export const applyOverlayMessage = (args: {
  state: OverlayState
  message: OverlayMessage
  cursorSeq: number
}): OverlayStep => {
  const { state, message, cursorSeq } = args
  if (message.type === 'overlay') return applyOverlay({ state, message, cursorSeq })
  if (message.type === 'delta') return applyDelta({ state, message })
  if (message.type === 'overlay-clear') {
    return noChange({ ...closeOverlay(state), resnapPending: false })
  }
  if (message.frame.type === 'step-end') return applyStepEnd({ state, key: message.frame.key })
  return noChange(state)
}

const closesOverlay = (args: { open: OpenOverlay; event: V2Event }): boolean => {
  const { open, event } = args
  if (event.runId !== open.key.runId) return false
  if (event.type === 'run-failed') return true
  if (event.type !== 'assistant-said') return false
  return event.step === undefined || event.step >= open.key.step
}

export const closeOverlayForEvents = (args: {
  state: OverlayState
  events: readonly V2Event[]
}): OverlayState => {
  const { state, events } = args
  const { open } = state
  if (open === undefined) return state
  return events.some((event) => closesOverlay({ open, event })) ? closeOverlay(state) : state
}
