import { Chat } from '@ai-sdk/react'
import type { AtlasStepMessage } from '@dltech/atlas-client/chat'
import type { Event } from '@dltech/atlas-core'

import { keptMessages } from './kept-messages'
import { createLiveThreadController, type LiveThreadControllerArgs } from './live-thread-controller'

export type LiveChatSession = {
  controller: ReturnType<typeof createLiveThreadController>
  chat: Chat<AtlasStepMessage>
  pruneTo(events: readonly Event[]): void
}

export function createLiveChatSession(
  args: Omit<LiveThreadControllerArgs, 'onStepOpened' | 'onReset'>,
): LiveChatSession {
  let held: Chat<AtlasStepMessage> | null = null
  let claiming: Promise<void> = Promise.resolve()

  const controller = createLiveThreadController({
    ...args,
    onStepOpened: () => {
      claiming = claiming.then(() => held?.resumeStream()).catch(() => undefined)
    },
    onReset: () => {
      const chat = held
      if (chat === null) return
      claiming = claiming
        .then(() => chat.stop())
        .then(() => {
          chat.messages = []
        })
        .catch(() => undefined)
    },
  })
  const chat = new Chat<AtlasStepMessage>({ transport: controller.chatTransport })
  held = chat
  const pruneTo = (events: readonly Event[]) => {
    const kept = keptMessages({ messages: chat.messages, events })
    if (kept !== chat.messages) chat.messages = [...kept]
  }
  return { controller, chat, pruneTo }
}
