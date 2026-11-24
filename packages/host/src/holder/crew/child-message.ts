import { INBOX_KIND_EVENT, inboxEventPayloadOf, type ThreadId } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import { messagePayloadOf } from './child-reports'

export type CrewSender = { agentId: ThreadId; agentType: string; intent: string }

const siblingEventOf = (args: {
  text: string
  from: CrewSender
  clientId?: string | undefined
}): string =>
  inboxEventPayloadOf({
    event: {
      type: 'agent-reported',
      agentId: args.from.agentId,
      agentType: args.from.agentType,
      intent: args.from.intent,
      prose: args.text,
    },
    ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
  })

export const inboxInputOf = (args: {
  text: string
  from?: CrewSender | undefined
  clientId?: string | undefined
}): { kind: string; payload: string } =>
  args.from === undefined
    ? {
        kind: INBOX_KIND_MESSAGE,
        payload: messagePayloadOf({
          text: args.text,
          ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
        }),
      }
    : {
        kind: INBOX_KIND_EVENT,
        payload: siblingEventOf({
          text: args.text,
          from: args.from,
          ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
        }),
      }
