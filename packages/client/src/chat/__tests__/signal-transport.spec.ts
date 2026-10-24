import { describe, expect, it } from 'bun:test'

import { EStepEnd, type StepSignal } from '../../channel'
import {
  ended,
  reasoningDelta,
  started,
  stepOne,
  stepTwo,
  textDelta,
  toolCall,
  toolInputDelta,
  toolInputStart,
} from '../../transcript/__tests__/fixture'
import { createSignalChatTransport } from '../signal-transport'
import { createTestChat, FIXED_NOW } from './test-chat'

const completed = (stepId: typeof stepOne) =>
  ended({ stepId, end: EStepEnd.Completed, supersededBy: null })

const feedAll = (args: {
  signals: ReturnType<typeof createTestChat>['signals']
  list: StepSignal[]
}) => {
  for (const signal of args.list) args.signals.absorb(signal)
}

describe('the signal chat transport', () => {
  it('reports a step start as an opened step and nothing else as one', () => {
    const { signals } = createTestChat()

    expect(signals.absorb(started(stepOne))).toEqual({ opened: true })
    expect(signals.absorb(textDelta({ stepId: stepOne, blockId: 'b1', text: 'a' }))).toEqual({
      opened: false,
    })
  })

  it('has no stream to resume when idle', async () => {
    const { signals } = createTestChat()

    expect(await signals.transport.reconnectToStream({ chatId: 'c' })).toBeNull()
  })

  it('has no stream to resume once the only step was claimed and finished', async () => {
    const { chat, signals } = createTestChat()
    feedAll({ signals, list: [started(stepOne), completed(stepOne)] })
    await chat.resumeStream()

    expect(await signals.transport.reconnectToStream({ chatId: 'c' })).toBeNull()
  })

  it('refuses to send through the chat', async () => {
    const { signals } = createTestChat()

    await expect(
      signals.transport.sendMessages({
        chatId: 'c',
        messages: [],
        trigger: 'submit-message',
        messageId: undefined,
        abortSignal: undefined,
      }),
    ).rejects.toThrow('channel')
  })

  it('replays what arrived before the chat claimed the step, then follows live', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [
        started(stepOne),
        reasoningDelta({ stepId: stepOne, blockId: 'r1', text: 'thinking' }),
        textDelta({ stepId: stepOne, blockId: 'b1', text: 'Hel' }),
      ],
    })

    const resumed = chat.resumeStream()
    await Bun.sleep(0)
    feedAll({
      signals,
      list: [
        textDelta({ stepId: stepOne, blockId: 'b1', text: 'lo' }),
        toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }),
        toolInputDelta({ stepId: stepOne, callId: 'call-1', text: '{"cmd":"l' }),
      ],
    })
    await Bun.sleep(0)

    expect(chat.status).toBe('streaming')
    expect(chat.messages).toHaveLength(1)
    const [message] = chat.messages
    expect(message?.id).toBe(stepOne)
    expect(message?.parts.map((part) => part.type)).toEqual([
      'step-start',
      'reasoning',
      'text',
      'dynamic-tool',
    ])
    expect(message?.parts[2]).toMatchObject({
      type: 'text',
      text: 'Hello',
      state: 'streaming',
    })
    expect(message?.parts[3]).toMatchObject({
      toolName: 'bash',
      toolCallId: 'call-1',
      state: 'input-streaming',
      input: { cmd: 'l' },
    })
    expect(message?.metadata?.callsAt).toEqual({
      'call-1': FIXED_NOW.toISOString(),
    })

    feedAll({
      signals,
      list: [
        toolCall({
          stepId: stepOne,
          callId: 'call-1',
          name: 'bash',
          input: { cmd: 'ls' },
        }),
        completed(stepOne),
      ],
    })
    await resumed

    expect(chat.status).toBe('ready')
    expect(chat.messages[0]?.parts[3]).toMatchObject({
      state: 'input-available',
      input: { cmd: 'ls' },
    })
    expect(chat.messages[0]?.metadata).toMatchObject({
      end: EStepEnd.Completed,
      stepId: stepOne,
    })
  })

  it('streams a step that ended before the chat claimed it in full', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [
        started(stepOne),
        textDelta({ stepId: stepOne, blockId: 'b1', text: 'done already' }),
        completed(stepOne),
      ],
    })

    await chat.resumeStream()

    expect(chat.status).toBe('ready')
    expect(chat.messages[0]?.parts.at(-1)).toMatchObject({
      type: 'text',
      text: 'done already',
      state: 'done',
    })
  })

  it('hands queued steps to successive resumes in order', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [
        started(stepOne),
        textDelta({ stepId: stepOne, blockId: 'b1', text: 'first' }),
        completed(stepOne),
        started(stepTwo),
        textDelta({ stepId: stepTwo, blockId: 'b1', text: 'second' }),
        completed(stepTwo),
      ],
    })

    await chat.resumeStream()
    expect(chat.messages.map((message) => message.id)).toEqual([stepOne])

    await chat.resumeStream()
    expect(chat.messages.map((message) => message.id)).toEqual([stepOne, stepTwo])
    expect(chat.messages[1]?.parts.at(-1)).toMatchObject({ text: 'second' })
  })

  it('closes a step still open when the next one starts', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [
        started(stepOne),
        textDelta({ stepId: stepOne, blockId: 'b1', text: 'stranded' }),
        started(stepTwo),
      ],
    })

    await chat.resumeStream()

    expect(chat.status).toBe('ready')
    expect(chat.messages.map((message) => message.id)).toEqual([stepOne])
    expect(chat.messages[0]?.parts.at(-1)).toMatchObject({ text: 'stranded' })
  })

  it('closes the open stream and forgets queued steps on dropAll', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [started(stepOne), textDelta({ stepId: stepOne, blockId: 'b1', text: 'a' })],
    })
    const resumed = chat.resumeStream()
    await Bun.sleep(0)

    signals.absorb(started(stepTwo))
    signals.dropAll()
    await resumed

    expect(chat.status).toBe('ready')
    expect(await signals.transport.reconnectToStream({ chatId: 'c' })).toBeNull()
  })

  it('forgets a step whose claim was aborted', async () => {
    const { signals } = createTestChat()
    feedAll({ signals, list: [started(stepOne)] })
    const abort = new AbortController()

    const stream = await signals.transport.reconnectToStream({
      chatId: 'c',
      abortSignal: abort.signal,
    })
    abort.abort()

    expect(stream).not.toBeNull()
    expect(await signals.transport.reconnectToStream({ chatId: 'c' })).toBeNull()
  })

  it('does not hand out a stream for an already aborted request', async () => {
    const { signals } = createTestChat()
    feedAll({ signals, list: [started(stepOne)] })
    const abort = new AbortController()
    abort.abort()

    expect(
      await signals.transport.reconnectToStream({
        chatId: 'c',
        abortSignal: abort.signal,
      }),
    ).toBeNull()
  })

  it('keeps a model error on the message without putting the chat into error', async () => {
    const { chat, signals } = createTestChat()
    feedAll({
      signals,
      list: [
        started(stepOne),
        {
          type: 'chunk',
          stepId: stepOne,
          chunk: { type: 'error', message: 'overloaded' },
        },
        ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
      ],
    })

    await chat.resumeStream()

    expect(chat.status).toBe('ready')
    expect(chat.messages[0]?.metadata).toMatchObject({
      errorMessage: 'overloaded',
      end: EStepEnd.Failed,
    })
  })

  it('exposes a standalone transport without a chat', () => {
    expect(createSignalChatTransport({ now: () => FIXED_NOW }).transport.resumeStreamIsReplay).toBe(
      true,
    )
  })
})
