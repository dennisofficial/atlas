import { EDefinitionOrigin, splitFrontmatter } from '@dltech/atlas-core'

import { isTeammateType, TEAMMATE_AGENT_TYPE } from '@dltech/atlas-core'

export { isTeammateType, TEAMMATE_AGENT_TYPE }

export const AGENT_SPAWN_TOOL_NAME = 'agent_spawn'

export const AGENT_TOOL_NAMES: readonly string[] = [
  AGENT_SPAWN_TOOL_NAME,
  'agent_say',
  'agent_list',
  'agent_stop',
]

export const WORKTREE_TOOL_NAMES: readonly string[] = [
  'enter_worktree',
  'exit_worktree',
  'worktree_list',
]

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export enum ESpeech {
  OnEnd = 'on-end',
  ByReport = 'by-report',
}

export type AgentType = {
  name: string
  whenToUse: string
  prompt: string
  model?: string | undefined
  speaks?: ESpeech | undefined
  origin: EDefinitionOrigin
  definedIn?: string | undefined
}

export const speechOf = (agentType: Pick<AgentType, 'speaks'>): ESpeech =>
  agentType.speaks ?? ESpeech.OnEnd

export enum EAgentTypeRefusal {
  Empty = 'empty',
  BadName = 'bad-name',
  ReservedName = 'reserved-name',
  NoDescription = 'no-description',
  NoPrompt = 'no-prompt',
  UnusableModel = 'unusable-model',
  Unreadable = 'unreadable',
}

export type AgentTypeRefusal = {
  refusal: EAgentTypeRefusal
  name: string | undefined
  definedIn: string | undefined
  origin: EDefinitionOrigin
  detail: string
}

export type AgentTypeRead = {
  types: readonly AgentType[]
  refusals: readonly AgentTypeRefusal[]
}

export type ParsedAgentType =
  | { ok: true; agentType: AgentType }
  | { ok: false; refusal: EAgentTypeRefusal; name: string; detail: string }

export abstract class AgentTypeSource {
  abstract readonly origin: EDefinitionOrigin
  abstract load(): Promise<AgentTypeRead>
}

const named = (args: { written: string | undefined; fallback: string }): string => {
  const declared = args.written?.trim()
  const chosen = declared === undefined || declared === '' ? args.fallback : declared
  return chosen.trim().toLowerCase()
}

const optionalText = (written: string | undefined): string | undefined => {
  const value = written?.trim()
  return value === undefined || value === '' ? undefined : value
}

const BAD_NAME =
  'a name must start with a letter and hold only lowercase letters, digits and hyphens, because the model passes it verbatim to agent_spawn'

const NO_DESCRIPTION =
  'there is no description: line in the frontmatter, and that line is how the model chooses this agent type'

const NO_PROMPT =
  'there is nothing below the frontmatter, so the agent type has no prompt to run on'

const EMPTY = 'the file is empty'

export function parseAgentType(args: {
  text: string
  fallbackName: string
  origin: EDefinitionOrigin
  definedIn?: string | undefined
}): ParsedAgentType {
  const refused = (refusal: EAgentTypeRefusal, detail: string): ParsedAgentType => ({
    ok: false,
    refusal,
    name: args.fallbackName,
    detail,
  })

  if (args.text.trim() === '') return refused(EAgentTypeRefusal.Empty, EMPTY)

  const { fields, body } = splitFrontmatter(args.text)

  const name = named({ written: fields.get('name'), fallback: args.fallbackName })
  if (!NAME_PATTERN.test(name)) {
    return refused(EAgentTypeRefusal.BadName, `"${name}" cannot name an agent type: ${BAD_NAME}`)
  }
  if (isTeammateType(name) && args.origin !== EDefinitionOrigin.BuiltIn) {
    return refused(
      EAgentTypeRefusal.ReservedName,
      `"${name}" is reserved for the built-in teammate, a full session the main agent manages`,
    )
  }

  const whenToUse = fields.get('description')?.trim()
  if (whenToUse === undefined || whenToUse === '') {
    return refused(EAgentTypeRefusal.NoDescription, NO_DESCRIPTION)
  }

  const prompt = body.trim()
  if (prompt === '') return refused(EAgentTypeRefusal.NoPrompt, NO_PROMPT)

  return {
    ok: true,
    agentType: {
      name,
      whenToUse,
      prompt,
      model: optionalText(fields.get('model')),
      origin: args.origin,
      definedIn: args.definedIn,
    },
  }
}
