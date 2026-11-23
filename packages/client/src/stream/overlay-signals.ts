import type { Chunk } from '@dltech/atlas-core'
import { EStreamBlockKind } from '@dltech/atlas-protocol'

import { EStepEnd, toStepId, type ChannelSignal, type StepId } from '../channel'
import type { OpenOverlay, OverlayBlock } from './overlay-store'

export type OverlaySignalSource = {
  overlay: OpenOverlay | undefined
  working: boolean
}

const sameKey = (args: { left: OpenOverlay; right: OpenOverlay }): boolean =>
  args.left.key.runId === args.right.key.runId &&
  args.left.key.step === args.right.key.step &&
  args.left.key.attempt === args.right.key.attempt

const stepIdOf = (overlay: OpenOverlay): StepId =>
  toStepId(`${overlay.key.runId}:${overlay.key.step}:${overlay.key.attempt}`)

const startChunkOf = (block: OverlayBlock): Chunk =>
  block.kind === EStreamBlockKind.Reasoning
    ? { type: 'reasoning-start', id: block.block }
    : { type: 'text-start', id: block.block }

const deltaChunkOf = (args: { block: OverlayBlock; text: string }): Chunk =>
  args.block.kind === EStreamBlockKind.Reasoning
    ? { type: 'reasoning-delta', id: args.block.block, text: args.text }
    : { type: 'text-delta', id: args.block.block, text: args.text }

const endedStepOf = (args: {
  previous: OpenOverlay | undefined
  open: OpenOverlay | undefined
  compares: boolean
}): OpenOverlay | null => {
  const { previous, open, compares } = args
  if (previous === undefined || previous.ended) return null
  if (open === undefined || !compares || open.ended) return previous
  return null
}

const blockOf = (args: {
  overlay: OpenOverlay | undefined
  block: string
}): OverlayBlock | undefined =>
  args.overlay?.blocks.find((candidate) => candidate.block === args.block)

const chunkSignalsOf = (args: {
  open: OpenOverlay
  previous: OpenOverlay | undefined
}): ChannelSignal[] => {
  const stepId = stepIdOf(args.open)
  const signals: ChannelSignal[] = []

  for (const block of args.open.blocks) {
    const before = blockOf({ overlay: args.previous, block: block.block })

    if (before === undefined) {
      signals.push({ type: 'chunk', stepId, chunk: startChunkOf(block) })
      if (block.text !== '')
        signals.push({ type: 'chunk', stepId, chunk: deltaChunkOf({ block, text: block.text }) })
      continue
    }

    if (!block.text.startsWith(before.text)) continue

    const suffix = block.text.slice(before.text.length)
    if (suffix !== '')
      signals.push({ type: 'chunk', stepId, chunk: deltaChunkOf({ block, text: suffix }) })
  }

  return signals
}

export const overlaySignalsOf = (args: {
  previous: OverlaySignalSource | undefined
  next: OverlaySignalSource
}): ChannelSignal[] => {
  const prev = args.previous?.overlay
  const open = args.next.overlay
  const compares = prev !== undefined && open !== undefined && sameKey({ left: prev, right: open })
  const ended = endedStepOf({ previous: prev, open, compares })

  const signals: ChannelSignal[] = []

  if (args.previous?.working !== args.next.working)
    signals.push({ type: 'turn-working', working: args.next.working })

  if (ended !== null)
    signals.push({
      type: 'step-ended',
      stepId: stepIdOf(ended),
      end: EStepEnd.Completed,
      supersededBy: null,
    })

  if (open === undefined) return signals
  if (compares && open.ended) return signals
  if (!compares) signals.push({ type: 'step-started', stepId: stepIdOf(open) })

  return [...signals, ...chunkSignalsOf({ open, previous: compares ? prev : undefined })]
}

export const overlayRewrote = (args: {
  previous: OverlaySignalSource | undefined
  next: OverlaySignalSource
}): boolean => {
  const prev = args.previous?.overlay
  const open = args.next.overlay
  if (prev === undefined || open === undefined) return false
  if (!sameKey({ left: prev, right: open })) return false

  return open.blocks.some((block) => {
    const before = blockOf({ overlay: prev, block: block.block })
    return before !== undefined && !block.text.startsWith(before.text)
  })
}
