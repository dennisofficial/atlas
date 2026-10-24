import { EBlockKind, type Chunk } from '@dltech/atlas-core'

import type { StepId, StepSignal } from '../channel'
import type { Clock } from '../transcript/in-flight-steps'
import type { AtlasStepChunk } from './atlas-step-message'

export type StepChunker = { chunksOf(signal: StepSignal): AtlasStepChunk[]; reset(): void }

type StepState = {
  stepId: StepId
  openBlocks: Map<string, { kind: EBlockKind; id: string }>
  openCalls: Set<string>
}

const blockKey = (args: { kind: EBlockKind; id: string }): string => `${args.kind}:${args.id}`

const opened = (stepId: StepId): { state: StepState; chunks: AtlasStepChunk[] } => ({
  state: { stepId, openBlocks: new Map(), openCalls: new Set() },
  chunks: [
    {
      type: 'start',
      messageId: stepId,
      messageMetadata: {
        stepId,
        end: null,
        supersededBy: null,
        errorMessage: null,
        callsAt: {},
      },
    },
    { type: 'start-step' },
  ],
})

function openBlock(args: { state: StepState; kind: EBlockKind; id: string }): AtlasStepChunk[] {
  const key = blockKey(args)
  if (args.state.openBlocks.has(key)) return []

  args.state.openBlocks.set(key, { kind: args.kind, id: args.id })
  return [
    {
      type: args.kind === EBlockKind.Text ? 'text-start' : 'reasoning-start',
      id: args.id,
    },
  ]
}

function openCall(args: {
  state: StepState
  callId: string
  name: string
  now: Clock
}): AtlasStepChunk[] {
  if (args.state.openCalls.has(args.callId)) return []

  args.state.openCalls.add(args.callId)
  return [
    {
      type: 'tool-input-start',
      toolCallId: args.callId,
      toolName: args.name,
      dynamic: true,
    },
    {
      type: 'message-metadata',
      messageMetadata: { callsAt: { [args.callId]: args.now().toISOString() } },
    },
  ]
}

function chunkChunks(args: { state: StepState; chunk: Chunk; now: Clock }): AtlasStepChunk[] {
  const { state, chunk, now } = args

  switch (chunk.type) {
    case 'text-start':
      return openBlock({ state, kind: EBlockKind.Text, id: chunk.id })
    case 'reasoning-start':
      return openBlock({ state, kind: EBlockKind.Reasoning, id: chunk.id })
    case 'text-delta':
      return [
        ...openBlock({ state, kind: EBlockKind.Text, id: chunk.id }),
        { type: 'text-delta', id: chunk.id, delta: chunk.text },
      ]
    case 'reasoning-delta':
      return [
        ...openBlock({ state, kind: EBlockKind.Reasoning, id: chunk.id }),
        { type: 'reasoning-delta', id: chunk.id, delta: chunk.text },
      ]
    case 'text-end': {
      const opening = openBlock({ state, kind: EBlockKind.Text, id: chunk.id })
      state.openBlocks.delete(blockKey({ kind: EBlockKind.Text, id: chunk.id }))
      return [...opening, { type: 'text-end', id: chunk.id }]
    }
    case 'reasoning-end': {
      const opening = openBlock({ state, kind: EBlockKind.Reasoning, id: chunk.id })
      state.openBlocks.delete(blockKey({ kind: EBlockKind.Reasoning, id: chunk.id }))
      return [...opening, { type: 'reasoning-end', id: chunk.id }]
    }
    case 'tool-input-start':
      return openCall({ state, callId: chunk.callId, name: chunk.name, now })
    case 'tool-input-delta':
      if (!state.openCalls.has(chunk.callId)) return []
      return [
        {
          type: 'tool-input-delta',
          toolCallId: chunk.callId,
          inputTextDelta: chunk.text,
        },
      ]
    case 'tool-call':
      return [
        ...openCall({ state, callId: chunk.callId, name: chunk.name, now }),
        {
          type: 'tool-input-available',
          toolCallId: chunk.callId,
          toolName: chunk.name,
          input: chunk.input,
          dynamic: true,
        },
      ]
    case 'error':
      return [
        {
          type: 'message-metadata',
          messageMetadata: { errorMessage: chunk.message },
        },
      ]
    case 'tool-input-end':
    case 'finish':
      return []
  }
}

const closingChunks = (state: StepState): AtlasStepChunk[] =>
  [...state.openBlocks.values()].map(({ kind, id }) => ({
    type: kind === EBlockKind.Text ? 'text-end' : 'reasoning-end',
    id,
  }))

export function createStepChunker(args: { now: Clock }): StepChunker {
  let current: StepState | null = null
  let lastEnded: StepState | null = null

  const reopened = (stepId: StepId): { state: StepState; chunks: AtlasStepChunk[] } =>
    lastEnded?.stepId === stepId ? { state: lastEnded, chunks: [] } : opened(stepId)

  return {
    reset() {
      current = null
      lastEnded = null
    },
    chunksOf(signal) {
      switch (signal.type) {
        case 'turn-working':
        case 'tool-output':
          return []
        case 'step-started': {
          const { state, chunks } = opened(signal.stepId)
          current = state
          return chunks
        }
        case 'chunk': {
          const opening = current?.stepId === signal.stepId ? null : reopened(signal.stepId)
          if (opening !== null) current = opening.state
          const state = opening?.state ?? current
          if (state === null) return []

          return [
            ...(opening?.chunks ?? []),
            ...chunkChunks({ state, chunk: signal.chunk, now: args.now }),
          ]
        }
        case 'step-ended': {
          if (current?.stepId !== signal.stepId) return []
          const closing = closingChunks(current)
          lastEnded = current
          current = null
          return [
            ...closing,
            {
              type: 'message-metadata',
              messageMetadata: {
                end: signal.end,
                supersededBy: signal.supersededBy,
              },
            },
            { type: 'finish-step' },
            { type: 'finish' },
          ]
        }
      }
    },
  }
}
