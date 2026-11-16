import { splitFrontmatter } from '@dltech/atlas-core'

import { CREW_AGENT_TYPES } from './agent-types'

export type RepoAgentType = {
  name: string
  whenToUse: string
  prompt: string
  definedIn: string
}

export type RepoAgentRefusal = {
  name: string
  definedIn: string
  reason: string
}

export type RepoAgentParse =
  | { ok: true; type: RepoAgentType }
  | { ok: false; refusal: RepoAgentRefusal }

const USABLE_NAME = /^[a-z][a-z0-9-]*$/

const TEAMMATE_AGENT_TYPE = 'teammate'

const builtInNames: ReadonlySet<string> = new Set(CREW_AGENT_TYPES.map((type) => type.name))

const refusalOf = (args: { name: string; definedIn: string; reason: string }): RepoAgentParse => ({
  ok: false,
  refusal: { name: args.name, definedIn: args.definedIn, reason: args.reason },
})

export const reservationOf = (name: string): string | undefined => {
  if (builtInNames.has(name)) return 'is a built-in agent type'
  if (name === TEAMMATE_AGENT_TYPE) return 'is reserved for the built-in teammate agent type'
  return undefined
}

export const parseRepoAgentType = (args: {
  text: string
  fallbackName: string
  definedIn: string
}): RepoAgentParse => {
  const { fields, body } = splitFrontmatter(args.text)
  const name = (fields.get('name') ?? args.fallbackName).trim().toLowerCase()
  const definedIn = args.definedIn

  if (!USABLE_NAME.test(name)) {
    return refusalOf({
      name,
      definedIn,
      reason:
        'is not a usable name: use lowercase letters, digits and dashes, starting with a letter',
    })
  }

  const reservation = reservationOf(name)
  if (reservation !== undefined) return refusalOf({ name, definedIn, reason: reservation })

  const description = (fields.get('description') ?? '').trim()
  if (description === '') return refusalOf({ name, definedIn, reason: 'has no description' })

  const prompt = body.trim()
  if (prompt === '') return refusalOf({ name, definedIn, reason: 'has no prompt' })

  return { ok: true, type: { name, whenToUse: description, prompt, definedIn } }
}

export const spawnPromptOf = (args: {
  contract: string
  brief: string
  prompt?: string | undefined
}): string =>
  args.prompt === undefined
    ? `${args.contract}\n\n${args.brief}`
    : `${args.contract}\n\n${args.prompt}\n\n${args.brief}`
