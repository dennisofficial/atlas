import {
  NO_PROMPT_GROUPS,
  type EPromptGroup,
  promptContextFor,
  type CompiledPrompt,
  type EExecutionLocation,
  type ERunner,
  type ProviderIdentity,
  type PromptPart,
} from '@dltech/atlas-core'

import type { PromptRegistry } from '../../prompt/registry'
import type { AgentType } from '../types'

export const AGENT_TYPE_PROMPT_PART = 'agent.type'

export function subAgentPrompt({
  prompts,
  agentType,
  provider,
  projectDirectory,
  groups = NO_PROMPT_GROUPS,
  placement,
  runner,
}: {
  prompts: PromptRegistry
  agentType: AgentType
  provider: ProviderIdentity
  projectDirectory: string
  groups?: readonly EPromptGroup[] | undefined
  placement?: EExecutionLocation | undefined
  runner?: ERunner | undefined
}): CompiledPrompt {
  const compiled = prompts.compile(
    promptContextFor({
      groups,
      provider,
      projectDirectory,
      placement,
      runner,
    }),
  )
  const identity = agentType.prompt.trim()

  const parts: readonly PromptPart[] = [
    ...(identity === ''
      ? []
      : [
          {
            id: AGENT_TYPE_PROMPT_PART,
            text: identity,
            chars: identity.length,
          },
        ]),
    ...compiled.parts,
  ]

  if (parts.length === 0) return { blocks: [], parts, skipped: compiled.skipped }

  return {
    blocks: [{ text: parts.map((part) => part.text).join('\n\n') }],
    parts,
    skipped: compiled.skipped,
  }
}
