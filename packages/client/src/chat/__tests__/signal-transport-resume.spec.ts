import { describe, expect, it } from 'bun:test'

import { EStepEnd, type StepSignal } from '../../channel'
import {
  ended,
  started,
  stepOne,
  textDelta,
  toolCall,
  toolInputStart,
} from '../../transcript/__tests__/fixture'
import { createTestChat } from './test-chat'

const detached = ended({ stepId: stepOne, end: EStepEnd.Detached, supersededBy: null })
const completed = ended({ stepId: stepOne, end: EStepEnd.Completed, supersededBy: null })
const say = (text: string) => textDelta({ stepId: stepOne, blockId: 'b1', text })

function createClaimingChat() {
  const { chat, signals } = createTestChat()
  let claiming: Promise<void> = Promise.resolve()
  const absorb = async (signal: StepSignal) => {
    if (signals.absorb(signal).opened) claiming = claiming.then(() => chat.resumeStream())
    await Bun.sleep(5)
  }
  return { chat, signals, absorb, settled: () => claiming }
}

describe('a step resumed after a detach', () => {
  it('keeps the text from before the detach', async () => {
    const { chat, absorb } = createClaimingChat()

    await absorb(started(stepOne))
    await absorb(say('Hello '))
    await absorb(detached)
    await absorb(say('world'))

    expect(chat.status).toBe('streaming')
    expect(chat.messages).toHaveLength(1)
    expect(chat.messages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'Hello world', state: 'streaming' },
    ])
    expect(chat.messages[0]?.metadata?.end).toBeNull()
  })

  it('finishes the rebuilt message when the step then completes', async () => {
    const { chat, absorb, settled } = createClaimingChat()

    await absorb(started(stepOne))
    await absorb(say('Hello '))
    await absorb(detached)
    await absorb(say('world'))
    await absorb(completed)
    await settled()

    expect(chat.status).toBe('ready')
    expect(chat.messages[0]?.parts.at(-1)).toMatchObject({ text: 'Hello world', state: 'done' })
    expect(chat.messages[0]?.metadata?.end).toBe(EStepEnd.Completed)
  })

  it('keeps a tool call opened before the detach as a single call', async () => {
    const { chat, absorb } = createClaimingChat()

    await absorb(started(stepOne))
    await absorb(toolInputStart({ stepId: stepOne, callId: 'call-1', name: 'bash' }))
    await absorb(detached)
    await absorb(
      toolCall({ stepId: stepOne, callId: 'call-1', name: 'bash', input: { cmd: 'ls' } }),
    )

    const calls = chat.messages[0]?.parts.filter((part) => part.type === 'dynamic-tool')
    expect(calls).toHaveLength(1)
    expect(calls?.[0]).toMatchObject({ state: 'input-available', input: { cmd: 'ls' } })
    expect(Object.keys(chat.messages[0]?.metadata?.callsAt ?? {})).toEqual(['call-1'])
  })

  it('starts over when the same step is announced again', async () => {
    const { chat, absorb } = createClaimingChat()

    await absorb(started(stepOne))
    await absorb(say('old'))
    await absorb(detached)
    await absorb(started(stepOne))
    await absorb(say('new'))

    expect(chat.messages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'new', state: 'streaming' },
    ])
  })
})

describe('dropping every step', () => {
  it('lets chunks of the step that was open start a fresh message', async () => {
    const { chat, signals, absorb } = createClaimingChat()
    await absorb(started(stepOne))
    await absorb(say('before'))

    signals.dropAll()
    chat.messages = []
    await absorb(say('after'))

    expect(chat.messages).toHaveLength(1)
    expect(chat.messages[0]?.parts.filter((part) => part.type === 'text')).toEqual([
      { type: 'text', text: 'after', state: 'streaming' },
    ])
  })
})
