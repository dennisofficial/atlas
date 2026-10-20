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
const TO_CLOUD: EventDraft = { type: 'location-changed', to: EExecutionLocation.Cloud }

const TRANSITIONS: readonly (readonly [string, EventDraft])[] = [
  ['entering a worktree', ENTERED],
  ['changing directory', { type: 'directory-changed', path: '/elsewhere', repo: '/elsewhere' }],
  ['moving to the cloud', TO_CLOUD],
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

  it('changes the system prompt on no step of enter, move to the cloud', () => {
    const baseline = assembleWith({ drafts: BASE })
    const steps = [
      baseline,
      assembleWith({ drafts: [...BASE, ENTERED] }),
      assembleWith({ drafts: [...BASE, ENTERED, TO_CLOUD] }),
    ]

    for (const step of steps) {
      expect(step.system).toEqual([{ text: DOCTRINE }])
      expect(step.messages.slice(0, 2)).toEqual(baseline.messages.slice(0, 2))
    }
  })

  it('states the worktree after entering it and the execution location in the tail note only', () => {
    const inTree = assembleWith({ drafts: [...BASE, ENTERED] })

    expect(textOf(inTree.messages.at(-1))).toContain(`Project directory: ${TREE}`)
    expect(textOf(inTree.messages.at(-1))).toContain('Execution location: a cloud sandbox')
    for (const entry of inTree.messages.slice(0, -1)) {
      expect(textOf(entry)).not.toContain('Execution location')
    }
  })

  it('resets to the launch directory on a real location change and does not claim the worktree is retained', () => {
    const note = textOf(assembleWith({ drafts: [...BASE, ENTERED, TO_CLOUD] }).messages.at(-1))

    expect(note).toContain(`Project directory: ${LAUNCH}.`)
    expect(note).not.toContain(TREE)
    expect(note).not.toContain('git worktree')
  })

  it('keeps every earlier message byte-identical as the tail reminders change', () => {
    const withReminders = assembleWith({ drafts: [...BASE, ENTERED, TO_CLOUD] })
    const later = assembleWith({
      drafts: [...BASE, ENTERED, TO_CLOUD, { type: 'user-said', text: 'continue' }],
    })

    expect(later.messages.slice(0, 2)).toEqual(withReminders.messages.slice(0, 2))
  })
})

describe('the cache prefix across a move to the cloud', () => {
  const conversation = conversationOf(60)
  const marksIn = (messages: readonly unknown[]): number =>
    messages.filter((entry) => JSON.stringify(entry).includes('cacheControl')).length

  it('holds the system and the 121 durable messages byte-identical through a real location event', () => {
    expect(conversation.filter((draft) => draft.type !== 'location-changed')).toHaveLength(121)

    const before = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inCloud = assembleWith({ drafts: [...conversation, TO_CLOUD], provider: CACHING_PROVIDER })

    const prefixOf = (assembled: typeof before): string =>
      JSON.stringify({ system: assembled.system, durable: assembled.messages.slice(0, 121) })

    expect(JSON.stringify(before.system)).toContain('cacheControl')
    expect(marksIn(before.messages.slice(0, 121))).toBeGreaterThan(0)
    expect(prefixOf(inCloud)).toBe(prefixOf(before))
  })

  it('keeps the whole prefix identical when the location changes, adding only the logged event', () => {
    const before = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inCloud = assembleWith({ drafts: [...conversation, TO_CLOUD], provider: CACHING_PROVIDER })

    const durable = (messages: readonly typeof inCloud.messages[number][]): readonly typeof inCloud.messages[number][] =>
      messages.filter((entry) => !textOf(entry).includes('Project directory'))

    expect(durable(inCloud.messages)).toEqual([...durable(before.messages)])
  })
})
