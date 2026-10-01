import { describe, expect, it } from 'bun:test'

import {
  EPromptAgent,
  ESkipReason,
  PromptFragment,
  deadFragmentIds,
  reachablePromptContexts,
  type PromptContext,
} from '@dltech/atlas-core'

import { createIsolatedContainer, portToken, resolveSet } from '../../container/injection'
import { ExecutionLocationToken } from '../../composition/execution-location-state'
import { SkillRegistryPort } from '../../skills/port'
import { registerBuiltinPromptFragments } from '../register-prompt-fragments'
import { PromptRegistry } from '../registry'
import { FakeSkillRegistry } from './fake-skills'

const CONTEXT: PromptContext = {
  agent: EPromptAgent.Main,
  provider: { id: 'anthropic-oauth', modelId: 'claude-opus-5' },
  model: { contextWindow: 1_000_000 },
  projectDirectory: '/w',
}

const registered = () => {
  const container = createIsolatedContainer()
  registerBuiltinPromptFragments({ container })
  container.register(portToken(SkillRegistryPort), {
    useValue: new FakeSkillRegistry({ skills: [] }),
  })
  return container
}

const compiled = () => registered().resolve(portToken(PromptRegistry)).compile(CONTEXT)

const REMOVED_PARTS = [
  'workflow.compaction-notice',
  'files.read-before-write',
  'files.read-wide',
  'tools.no-reread-after-write',
  'environment.project-directory',
  'environment.relative-paths',
]

const REGISTERED_PARTS = [
  'identity.atlas',
  'scope.request-ladder',
  'scope.concern-then-build',
  'scope.pace',
  'scope.open-questions',
  'scope.plan-first',
  'scope.decisions-are-theirs',
  'environment.today',
  'environment.execution-location',
  'tools.prefer-dedicated',
  'tools.parallel-calls',
  'tools.operator-sees-images',
  'shells.background',
  'plan.task-list',
  'agents.delegation',
  'safety.destructive-actions',
  'safety.git-etiquette',
  'output.lead-with-outcome',
  'output.readable-beats-terse',
  'output.shape',
  'output.cut-order',
  'output.cite-file-and-line',
  'skills.listing',
  'web.research',
  'web.untrusted-content',
  'models.answer-in-text',
]

describe('the builtin prompt', () => {
  it('uses a minimal identity and request boundary', () => {
    const parts = compiled().parts
    expect(parts[0]?.text).toBe('You are Atlas, a coding agent.')
    expect(parts.find((part) => part.id === 'scope.request-ladder')?.text).toBe(
      'For discussion, review, or diagnosis, inspect and answer. Implement when requested.',
    )
  })

  it('leaves file preconditions to tool refusals and compaction to continuation context', () => {
    const ids = compiled().parts.map((part) => part.id)
    for (const id of REMOVED_PARTS) expect(ids).not.toContain(id)
  })

  it('keeps system text unchanged when the project directory changes', () => {
    const prompts = registered().resolve(portToken(PromptRegistry))
    const first = prompts.compile(CONTEXT)
    const moved = prompts.compile({ ...CONTEXT, projectDirectory: '/w/.atlas/worktrees/feature' })
    expect(moved.blocks).toEqual(first.blocks)
    expect(first.blocks[0]?.text).not.toContain(CONTEXT.projectDirectory)
  })

  it('has no execution-state dependency while compiling stable topology', () => {
    const container = registered()
    container.register(ExecutionLocationToken, {
      useFactory: () => { throw new Error('runtime execution state belongs outside system text') },
    })
    const parts = container.resolve(portToken(PromptRegistry)).compile(CONTEXT).parts
    expect(parts.find((part) => part.id === 'environment.execution-location')?.text).toContain(
      'Local sessions execute commands and file operations on the host or in Docker.',
    )
  })

  it('uses affirmative notification guidance with accurate speech sources', () => {
    const text = compiled().parts.find((part) => part.id === 'shells.background')?.text ?? ''
    expect(text).toContain('background shell results, service exits, sub-agent answers, and teammate reports')
    expect(text).toContain('end your turn while waiting')
    expect(text).not.toContain('poll')
    expect(text).not.toContain('sleep')
    expect(text).not.toContain('runInBackground')
  })

  it('uses file-tool tracking without a snapshot or file-restoring rewind promise', () => {
    const parts = compiled().parts.filter((part) => part.id.startsWith('tools.'))
    const text = parts.map((part) => part.text).join('\n')
    expect(text).toContain('track reads and show changes')
    expect(text).not.toContain('snapshotted')
    expect(text).not.toContain('rewound')
  })

  it('keeps source selection and untrusted content instructions concise', () => {
    const parts = compiled().parts.filter((part) => part.id.startsWith('web.'))
    const text = parts.map((part) => part.text).join('\n')
    expect(text).toContain('current primary sources')
    expect(text).toContain('repository evidence')
    expect(text).toContain('only snippets')
    expect(text).toContain('as evidence')
    expect(text.length).toBeLessThan(400)
  })

  it('joins measured fragments in registration order', () => {
    const prompt = compiled()
    expect(prompt.blocks).toEqual([{ text: prompt.parts.map((part) => part.text).join('\n\n') }])
    expect(prompt.parts.map((part) => part.chars)).toEqual(prompt.parts.map((part) => part.text.length))
    expect(prompt.skipped).toEqual([
      { id: 'skills.listing', reason: ESkipReason.Empty },
      { id: 'models.answer-in-text', reason: ESkipReason.Condition },
    ])
  })
})

describe('builtin registration', () => {
  it('lists fragments in prompt order', () => {
    const fragments = resolveSet({ container: registered(), token: portToken(PromptFragment) })
    expect(fragments.map((fragment) => fragment.id)).toEqual(REGISTERED_PARTS)
  })

  it('selects every registered fragment in a reachable context', () => {
    const fragments = resolveSet({ container: registered(), token: portToken(PromptFragment) })
    expect(deadFragmentIds({
      fragments,
      contexts: [
        ...reachablePromptContexts({
          agents: Object.values(EPromptAgent),
          providerIds: ['anthropic-oauth'],
          projectDirectory: '/w',
        }),
        { ...CONTEXT, provider: { id: 'inference', modelId: 'kimi-k3-fast' } },
      ],
    })).toEqual([])
  })

  it('holds one registry per container', () => {
    const container = registered()
    expect(container.resolve(portToken(PromptRegistry))).toBe(container.resolve(portToken(PromptRegistry)))
  })
})
