import { agentDisplayName } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { HeldSessionDeps } from './held-session-deps'
import {
  PARENT_ADDRESS,
  type MessageSent,
  type PodCrew,
  type PodMessages,
} from '@dltech/atlas-plugin-sdk'

export const FIND_IDS = 'Find ids with agent_list, list_sessions or list_teammates.'

export type PodMessagesSource = {
  sessionId: string
  selfAgentId?: string | undefined
  crew: PodCrew
  plane: Pick<ControlPlane, 'messagePeer' | 'reportToSpawner'>
}

const refusing = (refused: string): MessageSent => ({
  refused: refused.endsWith('.') ? `${refused} ${FIND_IDS}` : `${refused}. ${FIND_IDS}`,
})

const parentOf = async (params: {
  source: PodMessagesSource
  text: string
}): Promise<MessageSent> => {
  const { source, text } = params
  if (source.selfAgentId !== undefined) {
    await source.crew.report({ text })
    return { delivered: true, to: PARENT_ADDRESS, queued: false }
  }
  const sent = await source.plane.reportToSpawner({ sessionId: source.sessionId, text })
  return 'refused' in sent
    ? refusing(sent.refused)
    : { delivered: true, to: PARENT_ADDRESS, queued: false }
}

const peerOf = async (params: {
  source: PodMessagesSource
  to: string
  text: string
}): Promise<MessageSent> => {
  const { source, to, text } = params
  const said = await source.crew.say({ agentId: to, text })
  if (said !== undefined) {
    const name = agentDisplayName({
      agentType: said.snapshot.agentType,
      intent: said.snapshot.intent,
    })
    return { delivered: true, to, name, queued: said.queued }
  }
  const sent = await source.plane.messagePeer({
    fromSessionId: source.sessionId,
    toSessionId: to,
    text,
  })
  if ('refused' in sent) return refusing(sent.refused)
  return {
    delivered: true,
    to,
    ...(sent.title === null ? {} : { name: sent.title }),
    queued: false,
  }
}

export const podMessagesOf = (source: PodMessagesSource): PodMessages => ({
  send: async ({ to, text }) => {
    if (to === PARENT_ADDRESS) return await parentOf({ source, text })
    if (to === source.sessionId) return { refused: `that is this session. ${FIND_IDS}` }
    if (to === source.selfAgentId) return { refused: `that is this sub-agent. ${FIND_IDS}` }
    return await peerOf({ source, to, text })
  },
})

export const heldMessagesOf = (args: {
  deps: Pick<HeldSessionDeps, 'sessionId' | 'plane'>
  crew: PodCrew
  selfAgentId?: string | undefined
}): PodMessages =>
  podMessagesOf({
    sessionId: args.deps.sessionId,
    plane: args.deps.plane,
    crew: args.crew,
    ...(args.selfAgentId === undefined ? {} : { selfAgentId: args.selfAgentId }),
  })
