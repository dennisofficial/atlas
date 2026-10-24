import type { ChatTransport } from 'ai'

import type { StepId, StepSignal } from '../channel'
import type { Clock } from '../transcript/in-flight-steps'
import type { AtlasStepChunk, AtlasStepMessage } from './atlas-step-message'
import { createStepChunker } from './step-chunks'

export type SignalChatTransport = {
  transport: ChatTransport<AtlasStepMessage>
  absorb(signal: StepSignal): { opened: boolean }
  dropAll(): void
}

type StepStream = {
  stepId: StepId
  buffered: AtlasStepChunk[]
  ended: boolean
  claimed: boolean
  controller: ReadableStreamDefaultController<AtlasStepChunk> | null
}

export function createSignalChatTransport(args: { now: Clock }): SignalChatTransport {
  const chunker = createStepChunker({ now: args.now })
  let streams: StepStream[] = []
  let feeding: StepStream | null = null
  const logs = new Map<StepId, AtlasStepChunk[]>()

  const forget = (stream: StepStream) => {
    streams = streams.filter((held) => held !== stream)
    if (feeding === stream) feeding = null
  }

  const closeLive = (stream: StepStream) => {
    const controller = stream.controller
    if (controller === null) return

    stream.controller = null
    controller.close()
    forget(stream)
  }

  const finishFeeding = () => {
    const stream = feeding
    if (stream === null) return

    feeding = null
    stream.ended = true
    closeLive(stream)
  }

  const feed = (args: { chunk: AtlasStepChunk; logged: boolean }) => {
    const { chunk } = args
    const stream = feeding
    if (stream === null) return

    if (args.logged) logs.get(stream.stepId)?.push(chunk)

    if (stream.controller === null) stream.buffered.push(chunk)
    else stream.controller.enqueue(chunk)
    if (chunk.type === 'finish') finishFeeding()
  }

  const openStream = (args: { stepId: StepId; replay: readonly AtlasStepChunk[] }) => {
    finishFeeding()
    const stream: StepStream = {
      stepId: args.stepId,
      buffered: [...args.replay],
      ended: false,
      claimed: false,
      controller: null,
    }
    streams.push(stream)
    feeding = stream
  }

  const claim = (stream: StepStream, abortSignal: AbortSignal | undefined) => {
    stream.claimed = true
    abortSignal?.addEventListener(
      'abort',
      () => {
        closeLive(stream)
        forget(stream)
      },
      { once: true },
    )

    return new ReadableStream<AtlasStepChunk>({
      start(controller) {
        for (const chunk of stream.buffered) controller.enqueue(chunk)
        stream.buffered = []
        if (stream.ended) {
          controller.close()
          forget(stream)
          return
        }
        stream.controller = controller
      },
      cancel() {
        stream.controller = null
        forget(stream)
      },
    })
  }

  const transport: ChatTransport<AtlasStepMessage> = {
    resumeStreamIsReplay: true,
    sendMessages: async () => {
      throw new Error('Messages are sent through the channel, not the chat')
    },
    reconnectToStream: async ({ abortSignal }) => {
      if (abortSignal?.aborted === true) return null

      const unclaimed = streams.find((stream) => !stream.claimed)
      return unclaimed === undefined ? null : claim(unclaimed, abortSignal)
    },
  }

  return {
    transport,
    absorb(signal) {
      const chunks = chunker.chunksOf(signal)
      if (signal.type !== 'step-started' && signal.type !== 'chunk') {
        for (const chunk of chunks) feed({ chunk, logged: false })
        return { opened: false }
      }

      const startsStep = chunks[0]?.type === 'start'
      const resumesEndedStep = !startsStep && chunks.length > 0 && feeding === null
      if (startsStep) {
        logs.clear()
        logs.set(signal.stepId, [])
      }
      if (startsStep || resumesEndedStep) {
        openStream({
          stepId: signal.stepId,
          replay: startsStep ? [] : (logs.get(signal.stepId) ?? []),
        })
      }
      for (const chunk of chunks) feed({ chunk, logged: true })
      return { opened: startsStep || resumesEndedStep }
    },
    dropAll() {
      for (const stream of [...streams]) closeLive(stream)
      streams = []
      feeding = null
      logs.clear()
      chunker.reset()
    },
  }
}
