import { describe, expect, it } from 'bun:test'

import { EEffort } from '../../effort-ladder'
import { EStalePolicy, resolveModelChoice, resolveModelChoices } from '../resolve-choice'
import { EModelRole, roleKey } from '../roles'
import type { CapabilitiesOf } from '../capabilities'
import {
  capabilitiesOf,
  FALLBACK_REF,
  GHOST_REF,
  MAIN_REF,
  PLAIN_REF,
  readOf,
  SUBAGENT_REF,
} from './choice-fixtures'

const main = { 'model.id': 'anthropic/claude-opus-5', 'model.effort': 'high', 'model.fast': true }

const choiceOf = (args: {
  role: Parameters<typeof resolveModelChoice>[0]['role']
  values?: Record<string, string | boolean>
  root?: Parameters<typeof resolveModelChoice>[0]['root']
  pinned?: (agentType: string) => string | undefined
  stale?: EStalePolicy
  capabilitiesOf?: CapabilitiesOf
}) =>
  resolveModelChoice({
    role: args.role,
    read: readOf(args.values ?? main),
    capabilitiesOf: args.capabilitiesOf ?? capabilitiesOf(),
    fallback: FALLBACK_REF,
    ...(args.root === undefined ? {} : { root: args.root }),
    ...(args.pinned === undefined ? {} : { pinned: args.pinned }),
    ...(args.stale === undefined ? {} : { stale: args.stale }),
  })

describe('resolveModelChoice', () => {
  it('carries ref, effort and fast down two layers to an agent type', () => {
    const choice = choiceOf({ role: { agentType: 'builder' } })

    expect(choice.ref).toEqual(MAIN_REF)
    expect(choice.effort).toBe(EEffort.High)
    expect(choice.fast).toBe(true)
    expect(choice.follows).toEqual(EModelRole.Subagents)
    expect(roleKey(choice.source)).toBe('main')
    expect(choice.stale).toBe(false)
  })

  it('clamps an own model effort the card does not offer to the next rung up', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      values: {
        ...main,
        'agents.type.builder': 'openai/gpt-5',
        'agents.type.builder.effort': 'high',
      },
    })

    expect(choice.ref).toEqual(PLAIN_REF)
    expect(choice.effort).toBe(EEffort.Medium)
    expect(choice.follows).toBeUndefined()
  })

  it('gives an own model with no effort of its own the parent effort, clamped to its card', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      values: { ...main, 'agents.type.builder': 'openai/gpt-5' },
    })

    expect(choice.effort).toBe(EEffort.Medium)
  })

  it('drops fast on a model that does not offer it', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      values: {
        ...main,
        'agents.type.builder': 'anthropic/claude-sonnet-5',
        'agents.type.builder.fast': true,
      },
    })

    expect(choice.ref).toEqual(SUBAGENT_REF)
    expect(choice.fast).toBe(false)
  })

  it('hangs the teammate off main rather than off the sub-agent model', () => {
    const choice = choiceOf({
      role: { agentType: 'teammate' },
      values: { ...main, 'agents.subagentModel': 'anthropic/claude-sonnet-5' },
    })

    expect(choice.ref).toEqual(MAIN_REF)
    expect(choice.follows).toEqual(EModelRole.Main)
  })

  it('counts the definition frontmatter pin as a model of its own', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      pinned: (agentType) => (agentType === 'builder' ? 'openai/gpt-5' : undefined),
    })

    expect(choice.ref).toEqual(PLAIN_REF)
    expect(choice.follows).toBeUndefined()
    expect(roleKey(choice.source)).toBe('agent-type:builder')
  })

  it('lets a root choice replace what the main settings say', () => {
    const root = { ref: PLAIN_REF, effort: EEffort.Low, fast: false }

    const mainChoice = choiceOf({ role: EModelRole.Main, root })
    expect(mainChoice.ref).toEqual(PLAIN_REF)
    expect(mainChoice.effort).toBe(EEffort.Low)
    expect(mainChoice.fast).toBe(false)
    expect(mainChoice.stale).toBe(false)

    const follower = choiceOf({ role: EModelRole.Subagents, root })
    expect(follower.ref).toEqual(PLAIN_REF)
    expect(follower.effort).toBe(EEffort.Low)
  })

  it('keeps a stale own choice for main under the keep policy', () => {
    const choice = choiceOf({
      role: EModelRole.Main,
      values: { 'model.id': 'openai/ghost-model', 'model.effort': 'high' },
    })

    expect(choice.ref).toEqual(GHOST_REF)
    expect(choice.stale).toBe(true)
    expect(choice.effort).toBe(EEffort.High)
  })

  it('falls back for main under the follow policy', () => {
    const choice = choiceOf({
      role: EModelRole.Main,
      values: { 'model.id': 'openai/ghost-model', 'model.effort': 'high' },
      stale: EStalePolicy.Follow,
    })

    expect(choice.ref).toEqual(FALLBACK_REF)
    expect(choice.stale).toBe(true)
  })

  it('keeps a stale own choice for a role under the keep policy', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      values: { ...main, 'agents.type.builder': 'openai/ghost-model' },
    })

    expect(choice.ref).toEqual(GHOST_REF)
    expect(choice.stale).toBe(true)
    expect(choice.follows).toBeUndefined()
  })

  it('treats a stale own choice as following under the follow policy', () => {
    const choice = choiceOf({
      role: { agentType: 'builder' },
      values: { ...main, 'agents.type.builder': 'openai/ghost-model' },
      stale: EStalePolicy.Follow,
    })

    expect(choice.ref).toEqual(MAIN_REF)
    expect(choice.follows).toEqual(EModelRole.Subagents)
    expect(choice.stale).toBe(true)
  })

  it('treats a model whose provider is unreachable as stale', () => {
    const choice = choiceOf({
      role: EModelRole.Main,
      capabilitiesOf: capabilitiesOf((providerId) => providerId !== 'anthropic'),
    })

    expect(choice.stale).toBe(true)
    expect(choice.ref).toEqual(MAIN_REF)
  })

  it('resolves many roles into one map keyed by role', () => {
    const choices = resolveModelChoices({
      roles: [EModelRole.Main, EModelRole.Subagents, { agentType: 'builder' }],
      read: readOf(main),
      capabilitiesOf: capabilitiesOf(),
      fallback: FALLBACK_REF,
    })

    expect([...choices.keys()]).toEqual(['main', 'subagents', 'agent-type:builder'])
    expect(choices.get('agent-type:builder')?.ref).toEqual(MAIN_REF)
  })
})
