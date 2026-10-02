import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../events/body'
import { EExecutionLocation } from '../../execution/location'
import type { CompiledPrompt } from '../../prompt/compiled'
import { assemble } from '../assemble'
import { defaultPipeline } from '../pipeline'
import { contextFor, log } from './log-fixture'

const DOCTRINE = 'You are Atlas, a coding agent talking to a developer in their terminal.'
const TREE = '/repo/.atlas/worktrees/topic'
const LAUNCH = '/repo'
const CACHING_PROVIDER = { id: 'anthropic', modelId: 'fixture-model' }

const compiled: CompiledPrompt = {
  blocks: [{ text: DOCTRINE }],
  parts: [{ id: 'fixture.doctrine', text: DOCTRINE, chars: DOCTRINE.length }],
  skipped: [],
}

const BASE: readonly EventDraft[] = [
  { type: 'user-said', text: 'hello' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
]

const ENTERED: EventDraft = { type: 'worktree-entered', path: TREE, branch: 'topic', base: 'origin/main' }
const TO_DOCKER: EventDraft = {
  type: 'location-changed',
  from: EExecutionLocation.Host,
  to: EExecutionLocation.Docker,
}
const TO_HOST: EventDraft = {
  type: 'location-changed',
  from: EExecutionLocation.Docker,
  to: EExecutionLocation.Host,
}

const TRANSITIONS: readonly (readonly [string, EventDraft])[] = [
  ['entering a worktree', ENTERED],
  ['changing directory', { type: 'directory-changed', path: '/elsewhere', repo: '/elsewhere' }],
  ['moving to the cloud', { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud }],
  ['moving to Docker', TO_DOCKER],
]

const assembleWith = ({
  drafts,
  provider,
}: {
  drafts: readonly EventDraft[]
  provider?: { id: string; modelId: string }
}) => {
  const { rules, annotators } = defaultPipeline({
    prompt: () => compiled,
    launchDirectory: LAUNCH,
  })
  const ctx = contextFor({ events: log(drafts) })

  return assemble({
    rules,
    annotators,
    ctx: provider === undefined ? ctx : { ...ctx, provider },
  }).assembled
}

const textOf = (entry: { message: unknown } | undefined): string => {
  const message = entry?.message as { content: readonly { type: string; text?: string }[] } | undefined
  return message?.content.find((part) => part.type === 'text')?.text ?? ''
}

const conversationOf = (pairs: number): EventDraft[] => [
  ...Array.from({ length: pairs }, (_unused, index): EventDraft[] => [
    { type: 'user-said', text: `question ${index}` },
    { type: 'assistant-said', parts: [{ type: 'text', text: `answer ${index}` }] },
  ]).flat(),
  { type: 'user-said', text: 'and now?' },
]

describe('runtime reminders across transitions', () => {
  for (const [name, transition] of TRANSITIONS) {
    it(`leaves the system prompt and the early conversation untouched on ${name}`, () => {
      const before = assembleWith({ drafts: BASE })
      const after = assembleWith({ drafts: [...BASE, transition] })

      expect(after.system).toEqual(before.system)
      expect(after.system).toEqual([{ text: DOCTRINE }])
      expect(after.messages.slice(0, 2)).toEqual(before.messages.slice(0, 2))
    })
  }

  it('adds no reminder to a completed exchange', () => {
    expect(assembleWith({ drafts: BASE }).messages).toHaveLength(2)
  })

  it('changes the system prompt on no step of enter, move to Docker, return to host', () => {
    const baseline = assembleWith({ drafts: BASE })
    const steps = [
      baseline,
      assembleWith({ drafts: [...BASE, ENTERED] }),
      assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER] }),
      assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER, TO_HOST] }),
    ]

    for (const step of steps) {
      expect(step.system).toEqual([{ text: DOCTRINE }])
      expect(step.messages.slice(0, 2)).toEqual(baseline.messages.slice(0, 2))
    }
  })

  it('states the worktree after entering it, and invents no execution-location tail', () => {
    const inTree = assembleWith({ drafts: [...BASE, ENTERED] })
    const inDocker = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER] })
    const backOnHost = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER, TO_HOST] })

    expect(textOf(inTree.messages.at(-1))).toContain(`Project directory: ${TREE}`)
    for (const assembled of [inTree, inDocker, backOnHost]) {
      for (const entry of assembled.messages) {
        expect(textOf(entry)).not.toContain('Execution location')
        expect(textOf(entry)).not.toContain('Docker container')
      }
    }
  })

  it('resets to the launch directory on a real location change and does not claim the worktree is retained', () => {
    for (const drafts of [
      [...BASE, ENTERED, TO_DOCKER],
      [...BASE, ENTERED, TO_DOCKER, TO_HOST],
    ]) {
      const note = textOf(assembleWith({ drafts }).messages.at(-1))

      expect(note).toContain(`Project directory: ${LAUNCH}.`)
      expect(note).not.toContain(TREE)
      expect(note).not.toContain('git worktree')
    }
  })

  it('keeps every earlier message byte-identical as the tail reminders change', () => {
    const withReminders = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER] })
    const later = assembleWith({
      drafts: [...BASE, ENTERED, TO_DOCKER, TO_HOST, { type: 'user-said', text: 'continue' }],
    })

    expect(later.messages.slice(0, 2)).toEqual(withReminders.messages.slice(0, 2))
  })
})

describe('the cache prefix across Host to Docker to Host', () => {
  const conversation = conversationOf(60)
  const marksIn = (messages: readonly unknown[]): number =>
    messages.filter((entry) => JSON.stringify(entry).includes('cacheControl')).length

  it('holds the system and the 121 durable messages byte-identical through real location events', () => {
    expect(conversation.filter((draft) => draft.type !== 'location-changed')).toHaveLength(121)

    const onHost = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inDocker = assembleWith({ drafts: [...conversation, TO_DOCKER], provider: CACHING_PROVIDER })
    const backOnHost = assembleWith({
      drafts: [...conversation, TO_DOCKER, TO_HOST],
      provider: CACHING_PROVIDER,
    })

    const prefixOf = (assembled: typeof onHost): string =>
      JSON.stringify({ system: assembled.system, durable: assembled.messages.slice(0, 121) })

    expect(JSON.stringify(onHost.system)).toContain('cacheControl')
    expect(marksIn(onHost.messages.slice(0, 121))).toBeGreaterThan(0)
    expect(prefixOf(inDocker)).toBe(prefixOf(onHost))
    expect(prefixOf(backOnHost)).toBe(prefixOf(onHost))
  })

  it('keeps the whole prefix identical when the location changes, adding only the logged event', () => {
    const onHost = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inDocker = assembleWith({ drafts: [...conversation, TO_DOCKER], provider: CACHING_PROVIDER })

    const durable = (messages: readonly typeof inDocker.messages[number][]): readonly typeof inDocker.messages[number][] =>
      messages.filter((entry) => !textOf(entry).includes('Project directory'))

    expect(durable(inDocker.messages)).toEqual([...durable(onHost.messages)])
  })
})
