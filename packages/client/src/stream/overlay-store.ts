import type { V2Event } from '@dltech/atlas-core'
import type { EStreamBlockKind, StreamServerMessage, StreamStepKey } from '@dltech/atlas-protocol'

const MAX_REMEMBERED_RUNS = 16

export type OverlayBlock = { block: string; kind: EStreamBlockKind; text: string }

export type OpenOverlay = { key: StreamStepKey; blocks: readonly OverlayBlock[] }

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
}): OverlayState => {
  const { state, key } = args
  const { open } = state
  const superseded =
    open === undefined || sameStep({ left: open.key, right: key })
      ? state
      : open.key.runId !== key.runId
        ? retireRun({ state, runId: open.key.runId })
        : retireStep({ state, key: open.key })
  return { ...superseded, open: { key, blocks: args.blocks }, resnapPending: false }
}

const applyOverlay = (args: {
  state: OverlayState
  message: Extract<OverlayMessage, { type: 'overlay' }>
}): OverlayStep => {
  const { state, message } = args
  if (isRetired({ state, key: message.key })) return noChange(state)
  if (state.open !== undefined && isEarlierInOpenRun({ key: message.key, open: state.open.key })) {
    return noChange(state)
  }
  const blocks = message.blocks.map(({ block, kind, text }) => ({ block, kind, text }))
  return noChange(openOverlay({ state, key: message.key, blocks }))
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
  return { key: open.key, blocks }
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

const applyStepEnd = (args: { state: OverlayState; key: StreamStepKey }): OverlayStep => {
  const { state, key } = args
  const retired = retireStep({ state, key })
  const closes = state.open !== undefined && sameStep({ left: state.open.key, right: key })
  return noChange({ ...retired, open: closes ? undefined : state.open, resnapPending: false })
}

export const applyOverlayMessage = (args: {
  state: OverlayState
  message: OverlayMessage
}): OverlayStep => {
  const { state, message } = args
  if (message.type === 'overlay') return applyOverlay({ state, message })
  if (message.type === 'delta') return applyDelta({ state, message })
  if (message.type === 'overlay-clear') {
    return noChange({ ...closeOverlay(state), resnapPending: false })
  }
  if (message.frame.type === 'step-end') return applyStepEnd({ state, key: message.frame.key })
  return noChange(state)
}

export const closeOverlayForEvents = (args: {
  state: OverlayState
  events: readonly V2Event[]
}): OverlayState => {
  const { state, events } = args
  const runId = state.open?.key.runId
  if (runId === undefined) return state
  const closes = events.some(
    (event) =>
      (event.type === 'assistant-said' || event.type === 'run-failed') && event.runId === runId,
  )
  return closes ? closeOverlay(state) : state
}
