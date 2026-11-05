import type { EStepEndReason } from '@dltech/atlas-core'
import {
  liveFrameSchema,
  type EStreamBlockKind,
  type LiveFrame,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { sameStep } from './step-order'

export type OverlayBlock = { block: string; kind: EStreamBlockKind; text: string }

export type FoldedStep = {
  key: StreamStepKey
  blocks: OverlayBlock[]
  end: EStepEndReason | undefined
}

const frameOf = (line: string): LiveFrame | undefined => {
  try {
    const parsed = liveFrameSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const appendAt = (args: { text: string; from: number; chunk: string }): string => {
  const { text, from, chunk } = args
  if (from > text.length || from + chunk.length <= text.length) return text
  return text + chunk.slice(text.length - from)
}

export const foldLiveBuffer = (raw: string | null): FoldedStep | undefined => {
  if (raw === null || raw.length === 0) return undefined
  let step:
    | { key: StreamStepKey; blocks: Map<string, OverlayBlock>; end?: EStepEndReason }
    | undefined
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const frame = frameOf(line)
    if (frame === undefined) continue
    if (frame.type === 'step-start') {
      step = { key: frame.key, blocks: new Map() }
      continue
    }
    if (step === undefined) continue
    if (frame.type === 'step-end' && sameStep(frame.key, step.key)) {
      step.end = frame.reason
      continue
    }
    if (frame.type !== 'delta' || !sameStep(frame.key, step.key)) continue
    const block = step.blocks.get(frame.block) ?? { block: frame.block, kind: frame.kind, text: '' }
    block.text = appendAt({ text: block.text, from: frame.from, chunk: frame.text })
    step.blocks.set(frame.block, block)
  }
  if (step === undefined) return undefined
  return { key: step.key, blocks: [...step.blocks.values()], end: step.end }
}
