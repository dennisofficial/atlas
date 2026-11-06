import { isTeammateType } from './kind'

const QUOTED_INTENT_CHARACTERS = 120

const ELLIPSIS = '…'

function clippedIntent(intent: string): string {
  const single = intent.replace(/\s+/g, ' ').trim()
  return single.length <= QUOTED_INTENT_CHARACTERS
    ? single
    : `${single.slice(0, QUOTED_INTENT_CHARACTERS)}${ELLIPSIS}`
}

export function quotedAgentIntent(intent: string): string {
  const shown = clippedIntent(intent)
  return shown === '' ? '' : `"${shown}"`
}

export function agentLabel(args: { agentType: string; intent: string }): string {
  const quoted = quotedAgentIntent(args.intent)
  return quoted === '' ? args.agentType : `${args.agentType} ${quoted}`
}

export function childThreadTitle(args: { agentType: string; intent: string }): string {
  if (!isTeammateType(args.agentType)) return agentLabel(args)
  return clippedIntent(args.intent) || args.agentType
}
