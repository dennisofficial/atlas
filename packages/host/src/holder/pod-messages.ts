import { agentDisplayName } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { HeldSessionDeps } from './held-session-deps'
import type { HostStepPort } from './record/host-step'
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
  step?: HostStepPort | undefined
}

const refusing = (refused: string): MessageSent => ({
  refused: refused.endsWith('.') ? `${refused} ${FIND_IDS}` : `${refused}. ${FIND_IDS}`,
})

const parentOf = async (params: {
  source: PodMessagesSource
  text: string
  clientId?: string | undefined
}): Promise<MessageSent> => {
  const { source, text, clientId } = params
  if (source.selfAgentId !== undefined) {
    await source.crew.report({ text, ...(clientId === undefined ? {} : { clientId }) })
    return { delivered: true, to: PARENT_ADDRESS, queued: false }
  }
  const sent = await source.plane.reportToSpawner({
    sessionId: source.sessionId,
    text,
    ...(clientId === undefined ? {} : { clientId }),
  })
  return 'refused' in sent
    ? refusing(sent.refused)
    : { delivered: true, to: PARENT_ADDRESS, queued: false }
}

const peerOf = async (params: {
  source: PodMessagesSource
  to: string
  text: string
  clientId?: string | undefined
}): Promise<MessageSent> => {
  const { source, to, text, clientId } = params
  const said = await source.crew.say({
    agentId: to,
    text,
    ...(clientId === undefined ? {} : { clientId }),
  })
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
    ...(clientId === undefined ? {} : { clientId }),
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
    const step = await source.step?.({ op: 'messages.send', input: { to, text } })
    const clientId = step?.key
    const keyed = clientId === undefined ? {} : { clientId }
    if (to === PARENT_ADDRESS) return await parentOf({ source, text, ...keyed })
    if (to === source.sessionId) return { refused: `that is this session. ${FIND_IDS}` }
    if (to === source.selfAgentId) return { refused: `that is this sub-agent. ${FIND_IDS}` }
    return await peerOf({ source, to, text, ...keyed })
  },
})

export const heldMessagesOf = (args: {
  deps: Pick<HeldSessionDeps, 'sessionId' | 'plane'>
  crew: PodCrew
  selfAgentId?: string | undefined
  step?: HostStepPort | undefined
}): PodMessages =>
  podMessagesOf({
    sessionId: args.deps.sessionId,
    plane: args.deps.plane,
    crew: args.crew,
    ...(args.selfAgentId === undefined ? {} : { selfAgentId: args.selfAgentId }),
    ...(args.step === undefined ? {} : { step: args.step }),
  })
