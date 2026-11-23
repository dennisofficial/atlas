import { INBOX_KIND_EVENT, inboxEventPayloadOf, type ThreadId } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { messagePayloadOf } from './child-reports'

export type CrewSender = { agentId: ThreadId; agentType: string; intent: string }

const siblingEventOf = (args: { text: string; from: CrewSender }): string =>
  inboxEventPayloadOf({
    event: {
      type: 'agent-reported',
      agentId: args.from.agentId,
      agentType: args.from.agentType,
      intent: args.from.intent,
      prose: args.text,
    },
  })

export const inboxInputOf = (args: {
  text: string
  from?: CrewSender | undefined
}): { kind: string; payload: string } =>
  args.from === undefined
    ? { kind: INBOX_KIND_MESSAGE, payload: messagePayloadOf({ text: args.text }) }
    : { kind: INBOX_KIND_EVENT, payload: siblingEventOf({ text: args.text, from: args.from }) }
