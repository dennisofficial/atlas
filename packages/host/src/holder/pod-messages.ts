import { agentDisplayName } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { HeldSessionDeps } from './held-session-deps'
import {
  PARENT_ADDRESS,
  type MessageSent,
  type PodCrew,
  type PodMessages,
} from '@dltech/atlas-plugin-sdk'

import type { PodStepRunner } from './plugin-context'

export const FIND_IDS = 'Find ids with agent_list, list_sessions or list_teammates.'

export type PodMessagesSource = {
  sessionId: string
  selfAgentId?: string | undefined
  crew: Pick<PodCrew, 'say' | 'report'>
  plane: Pick<ControlPlane, 'messagePeer' | 'reportToSpawner'>
  step: PodStepRunner
}

const refusing = (refused: string): MessageSent => ({
  refused: refused.endsWith('.') ? `${refused} ${FIND_IDS}` : `${refused}. ${FIND_IDS}`,
})

const parentOf = async (params: {
  source: PodMessagesSource
  text: string
  clientId: string
  replayed?: boolean | undefined
}): Promise<MessageSent> => {
  const { source, text, clientId, replayed } = params
  if (source.selfAgentId !== undefined) {
    await source.crew.report({ text, clientId })
    return { delivered: true, to: PARENT_ADDRESS, queued: false }
  }
  const sent = await source.plane.reportToSpawner({
    sessionId: source.sessionId,
    text,
    clientId,
    replayed,
  })
  return 'refused' in sent
    ? refusing(sent.refused)
    : { delivered: true, to: PARENT_ADDRESS, queued: false }
}

const peerOf = async (params: {
  source: PodMessagesSource
  to: string
  text: string
  clientId: string
  replayed?: boolean | undefined
}): Promise<MessageSent> => {
  const { source, to, text, clientId, replayed } = params
  const said = await source.crew.say({ agentId: to, text, clientId })
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
    clientId,
    replayed,
  })
  if ('refused' in sent) return refusing(sent.refused)
  return {
    delivered: true,
    to,
    ...(sent.title === null ? {} : { name: sent.title }),
    queued: false,
  }
}

const sendOf = async (params: {
  source: PodMessagesSource
  to: string
  text: string
  clientId: string
  replayed?: boolean | undefined
}): Promise<MessageSent> => {
  const { source, to } = params
  if (to === PARENT_ADDRESS) return await parentOf(params)
  if (to === source.sessionId) return { refused: `that is this session. ${FIND_IDS}` }
  if (to === source.selfAgentId) return { refused: `that is this sub-agent. ${FIND_IDS}` }
  return await peerOf(params)
}

export const podMessagesOf = (source: PodMessagesSource): PodMessages => ({
  send: async (input) =>
    await source.step.run({
      op: 'host.messages.send',
      input,
      run: async (key, replayed) => await sendOf({ source, ...input, clientId: key, replayed }),
    }),
})

export const heldMessagesOf = (args: {
  deps: Pick<HeldSessionDeps, 'sessionId' | 'plane'>
  crew: PodCrew
  step: PodStepRunner
  selfAgentId?: string | undefined
}): PodMessages =>
  podMessagesOf({
    sessionId: args.deps.sessionId,
    plane: args.deps.plane,
    crew: args.crew,
    step: args.step,
    ...(args.selfAgentId === undefined ? {} : { selfAgentId: args.selfAgentId }),
  })
