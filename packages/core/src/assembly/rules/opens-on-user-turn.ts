import { systemContext } from '../../context/envelope'
import type { AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

export const OMITTED_HISTORY =
  'Earlier turns of this conversation are not part of this context. The exchange below picks up partway through.'

const omittedMessage = (first: AssembledMessage): AssembledMessage => ({
  message: {
    role: 'user',
    content: [
      {
        type: 'text',
        text: systemContext({ slot: 'history', key: 'omitted', content: OMITTED_HISTORY }),
      },
    ],
  },
  origin: first.origin,
})

export function opensOnUserTurn(): Rule {
  return defineRule({
    name: 'opensOnUserTurn',
    apply: (input) => {
      const opening = input.messages.findIndex((entry) => entry.message.role !== 'tool')
      const messages = opening === -1 ? [] : input.messages.slice(opening)
      const first = messages[0]
      if (first === undefined || first.message.role === 'user') {
        return messages.length === input.messages.length ? input : { ...input, messages }
      }
      return { ...input, messages: [omittedMessage(first), ...messages] }
    },
  })
}
