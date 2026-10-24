import { AbstractChat, type ChatState, type ChatStatus } from 'ai'

import { createSignalChatTransport } from '../signal-transport'
import type { AtlasStepMessage } from '../atlas-step-message'

class MemoryChatState implements ChatState<AtlasStepMessage> {
  status: ChatStatus = 'ready'
  error: Error | undefined = undefined
  messages: AtlasStepMessage[] = []

  pushMessage = (message: AtlasStepMessage) => {
    this.messages = [...this.messages, message]
  }

  popMessage = () => {
    this.messages = this.messages.slice(0, -1)
  }

  replaceMessage = (index: number, message: AtlasStepMessage) => {
    this.messages = this.messages.map((held, at) => (at === index ? message : held))
  }

  snapshot = <T>(thing: T): T => structuredClone(thing)
}

class TestChat extends AbstractChat<AtlasStepMessage> {}

export const FIXED_NOW = new Date('2026-03-04T05:06:07.000Z')

export function createTestChat() {
  const signals = createSignalChatTransport({ now: () => FIXED_NOW })
  const chat = new TestChat({
    transport: signals.transport,
    state: new MemoryChatState(),
  })
  return { chat, signals }
}
