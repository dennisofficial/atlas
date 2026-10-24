import type { Event } from '@dltech/atlas-core'

import { liveSteps, runKey, type InFlightStep } from './in-flight-steps'
import type { RevealGate } from './reveal-gate'

export const FRAME_MS = 33

const REVEAL_HORIZON_MS = 150

const REVEAL_MIN_CHARS = 3

const REVEAL_FLOOR_CHARS = 40

export type TailRun = { key: string; text: string }

export function tailRunOfSteps(args: {
  steps: readonly InFlightStep[]
  events: readonly Event[]
}): TailRun | null {
  const step = liveSteps({ steps: args.steps, events: args.events }).at(-1)
  if (step === undefined || step.end !== null) return null

  const block = step.blocks.at(-1)
  if (block === undefined) return null

  return {
    key: runKey({ stepId: step.stepId, kind: block.kind, id: block.id }),
    text: block.text,
  }
}

export function attachedGate(args: {
  gate: RevealGate | null
  tail: TailRun | null
}): RevealGate | null {
  if (args.tail === null) return null
  if (args.gate?.key === args.tail.key) return args.gate

  return { key: args.tail.key, revealed: 0 }
}

export function advancedGate(args: {
  gate: RevealGate | null
  tail: TailRun | null
}): RevealGate | null {
  const attached = attachedGate(args)
  if (attached === null || args.tail === null) return null

  const backlog = args.tail.text.length - attached.revealed
  if (backlog <= 0) return attached

  const frames = Math.max(1, Math.round(REVEAL_HORIZON_MS / FRAME_MS))
  const reached = attached.revealed + proportionalDrainSlice({ backlog, frames })
  return {
    key: attached.key,
    revealed: pastAnyLoneSurrogate({ text: args.tail.text, at: reached }),
  }
}

export const gateIsDraining = (args: { gate: RevealGate | null; tail: TailRun | null }): boolean =>
  args.tail !== null &&
  (args.gate?.key !== args.tail.key || args.gate.revealed < args.tail.text.length)

function proportionalDrainSlice(args: { backlog: number; frames: number }): number {
  const proportional = Math.ceil(args.backlog / args.frames)
  const sized = Math.max(REVEAL_MIN_CHARS, REVEAL_FLOOR_CHARS, proportional)
  return Math.min(args.backlog, sized)
}

function pastAnyLoneSurrogate(args: { text: string; at: number }): number {
  const code = args.text.charCodeAt(args.at - 1)
  const isHighSurrogate = code >= 0xd800 && code <= 0xdbff
  return isHighSurrogate && args.at < args.text.length ? args.at + 1 : args.at
}
