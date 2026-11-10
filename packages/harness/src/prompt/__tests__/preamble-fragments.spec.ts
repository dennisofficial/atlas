import { describe, expect, it } from 'bun:test'

import {
  ALL_PROMPT_GROUPS,
  ESkipReason,
  PromptFragment,
  deadFragmentIds,
  reachablePromptContexts,
  type PromptContext,
  NO_PROMPT_GROUPS,
} from '@dltech/atlas-core'

import {
  createIsolatedContainer,
  portToken,
  registeredPortToken,
  resolveSet,
} from '../../container/injection'
import { GrillingCeremonyEnabledToken } from '../../container/tokens'
import { ExecutionLocationToken } from '../../composition/execution-location-state'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { FakeSkillRegistry } from './fake-skills'

const CONTEXT: PromptContext = {
  groups: ALL_PROMPT_GROUPS,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  projectDirectory: '/prompt-primary-fixture',
}

const registered = () => {
  const container = createIsolatedContainer()
  container.register(GrillingCeremonyEnabledToken, { useValue: () => false })
  registerBuiltinPromptFragments({ container })
  container.register(registeredPortToken(SkillRegistryPort), {
    useValue: new FakeSkillRegistry({ skills: [] }),
  })
  return container
}

const compiled = () => registered().resolve(registeredPortToken(PromptRegistry)).compile(CONTEXT)

const REMOVED_PARTS = [
  'scope.request-ladder',
  'workflow.compaction-notice',
  'files.read-before-write',
  'files.read-wide',
  'tools.no-reread-after-write',
  'environment.project-directory',
  'environment.relative-paths',
]

const LEAN_REMOVED_PARTS = [
  'environment.session-paths',
  'shells.background',
  'tools.operator-input',
  'tools.operator-sees-images',
  'web.untrusted-content',
  'web.research',
  'scope.concern-then-build',
]

describe('the builtin prompt', () => {
  it('opens with identity and carries no generic request-handling guidance', () => {
    const parts = compiled().parts
    expect(parts[0]?.id).toBe('identity.atlas')
    expect(parts.some((part) => part.id === 'scope.request-ladder')).toBe(false)
  })

  it('leaves file preconditions to tool refusals and compaction to continuation context', () => {
    const ids = compiled().parts.map((part) => part.id)
    for (const id of REMOVED_PARTS) expect(ids).not.toContain(id)
  })

  it('keeps system text unchanged when the project directory changes', () => {
    const prompts = registered().resolve(registeredPortToken(PromptRegistry))
    const first = prompts.compile(CONTEXT)
    const moved = prompts.compile({
      ...CONTEXT,
      projectDirectory: `${CONTEXT.projectDirectory}/.atlas/worktrees/feature`,
    })
    expect(moved.blocks).toEqual(first.blocks)
    expect(first.blocks[0]?.text).not.toContain(CONTEXT.projectDirectory)
  })

  it('compiles the stable execution topology without touching runtime execution state', () => {
    const container = registered()
    container.register(ExecutionLocationToken, {
      useFactory: () => {
        throw new Error('runtime execution state belongs outside system text')
      },
    })
    const parts = container.resolve(registeredPortToken(PromptRegistry)).compile(CONTEXT).parts
    expect(parts.some((part) => part.id === 'environment.execution-location')).toBe(true)
  })

  it('names the work loop after the investigation rule', () => {
    const ids = compiled().parts.map((part) => part.id)
    expect(ids.indexOf('scope.work-loop')).toBe(ids.indexOf('scope.investigate-then-explain') + 1)
    expect(compiled().parts.find((part) => part.id === 'scope.work-loop')?.text).toContain(
      'Run the full suite once, at the end.',
    )
  })

  it('folds the raise-a-concern rule into the answer-honestly fragment', () => {
    const ids = compiled().parts.map((part) => part.id)
    expect(ids).not.toContain('scope.concern-then-build')
    expect(ids.indexOf('scope.answer-honestly')).toBe(
      ids.indexOf('scope.investigate-then-explain') - 1,
    )
    const text = compiled().parts.find((part) => part.id === 'scope.answer-honestly')?.text ?? ''
    expect(text).toContain('the developer repeats the request')
    expect(text).toContain('Skip praise and filler.')
  })

  it('leaves out the fragments whose rules live in tool contracts', () => {
    const ids = compiled().parts.map((part) => part.id)
    for (const id of LEAN_REMOVED_PARTS) expect(ids).not.toContain(id)
  })

  it('makes no snapshot or file-restoring rewind promise in tool guidance', () => {
    const parts = compiled().parts.filter((part) => part.id.startsWith('tools.'))
    const text = parts.map((part) => part.text).join('\n')
    expect(text).not.toContain('snapshotted')
    expect(text).not.toContain('rewound')
  })

  it('grounds answers about the workspace in evidence read first', () => {
    const part = compiled().parts.find((part) => part.id === 'scope.investigate-then-explain')
    expect(part).toBeDefined()
    expect(part?.text).toContain('evidence')
    expect(part?.text).toContain('read the code')
    expect(part?.text).toContain('what is currently true')
  })

  it('keeps the web guidance short', () => {
    const parts = compiled().parts.filter((part) => part.id.startsWith('web.'))
    const text = parts.map((part) => part.text).join('\n')
    expect(text.length).toBeLessThan(400)
  })

  it('joins measured fragments in registration order', () => {
    const prompt = compiled()
    expect(prompt.blocks).toEqual([{ text: prompt.parts.map((part) => part.text).join('\n\n') }])
    expect(prompt.parts.map((part) => part.chars)).toEqual(
      prompt.parts.map((part) => part.text.length),
    )
    expect(prompt.skipped).toEqual([
      { id: 'environment.declared-services', reason: ESkipReason.Empty },
      { id: 'skills.listing', reason: ESkipReason.Empty },
      { id: 'models.answer-in-text', reason: ESkipReason.Condition },
      { id: 'plan.grilling-ceremony', reason: ESkipReason.Empty },
    ])
  })
})

describe('builtin registration', () => {
  it('selects every registered fragment in a reachable context', () => {
    const fragments = resolveSet({
      container: registered(),
      token: portToken(PromptFragment),
    })
    expect(
      deadFragmentIds({
        fragments,
        contexts: [
          ...reachablePromptContexts({
            groupSets: [ALL_PROMPT_GROUPS, NO_PROMPT_GROUPS],
            providerIds: ['anthropic-oauth'],
            projectDirectory: '/prompt-primary-fixture',
          }),
          {
            ...CONTEXT,
            provider: { id: 'inference', modelId: 'kimi-k3-fast' },
          },
        ],
      }),
    ).toEqual([])
  })

  it('holds one registry per container', () => {
    const container = registered()
    expect(container.resolve(registeredPortToken(PromptRegistry))).toBe(
      container.resolve(registeredPortToken(PromptRegistry)),
    )
  })
})
