import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../events/body'
import { EExecutionLocation } from '../../execution/location'
import type { CompiledPrompt } from '../../prompt/compiled'
import type { Assembled, AssembledMessage } from '../assembled'
import { assemble } from '../assemble'
import { defaultPipeline } from '../pipeline'
import { contextFor, log } from './log-fixture'

const DOCTRINE = 'You are Atlas, a coding agent talking to a developer in their terminal.'
const TREE = '/repo/.atlas/worktrees/topic'
const LAUNCH = '/repo'
const CACHING_PROVIDER = { id: 'anthropic', modelId: 'fixture-model' }

const compiled: CompiledPrompt = {
  blocks: [{ text: DOCTRINE }],
  parts: [],
  skipped: [],
}

const BASE: readonly EventDraft[] = [
  { type: 'user-said', text: 'hello' },
  { type: 'assistant-said', parts: [{ type: 'text', text: 'hi there' }] },
]

const ENTERED: EventDraft = {
  type: 'worktree-entered',
  path: TREE,
  branch: 'topic',
  base: 'origin/main',
}
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
  [
    'moving to the cloud',
    { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
  ],
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

const textOf = (entry: AssembledMessage | undefined): string =>
  entry?.message.content.find((part) => part.type === 'text')?.text ?? ''

const isWorkspaceNote = (text: string): boolean =>
  text.startsWith('<system') && text.includes('workspace')

const withoutNote = (messages: Assembled['messages']): readonly AssembledMessage[] =>
  messages.filter((entry) => !isWorkspaceNote(textOf(entry)))

const shapeOf = (messages: Assembled['messages']): readonly { role: string; text: string }[] =>
  withoutNote(messages).map((entry) => ({ role: entry.message.role, text: textOf(entry) }))

const notesOf = (messages: Assembled['messages']): readonly AssembledMessage[] =>
  messages.filter((entry) => isWorkspaceNote(textOf(entry)))

const noteOf = (assembled: Assembled): string => textOf(notesOf(assembled.messages)[0])

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
      expect(after.system).toEqual([{ text: DOCTRINE, source: 'system-prompt' }])
      expect(withoutNote(after.messages).slice(0, 2)).toEqual(
        withoutNote(before.messages).slice(0, 2),
      )
    })
  }

  it('adds no reminder to the tail of a completed exchange', () => {
    const assembled = assembleWith({ drafts: BASE })

    expect(withoutNote(assembled.messages)).toHaveLength(2)
    expect(assembled.messages.at(-1)?.message.role).toBe('assistant')
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
      expect(step.system).toEqual([{ text: DOCTRINE, source: 'system-prompt' }])
      expect(withoutNote(step.messages).slice(0, 2)).toEqual(
        withoutNote(baseline.messages).slice(0, 2),
      )
    }
  })

  it('states the worktree after entering it, and names the execution location only while the session is away from the host', () => {
    const inTree = assembleWith({ drafts: [...BASE, ENTERED] })
    const inDocker = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER] })
    const backOnHost = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER, TO_HOST] })

    expect(noteOf(inTree)).toContain(`Project directory: ${TREE}`)
    expect(noteOf(inDocker)).toContain('Execution location: a Docker sandbox')
    for (const assembled of [inTree, backOnHost]) {
      expect(assembled.messages.map(textOf).join('\n')).not.toContain('Execution location')
      expect(assembled.messages.map(textOf).join('\n')).not.toContain('Docker container')
    }
    for (const entry of withoutNote(inDocker.messages)) {
      expect(textOf(entry)).not.toContain('Execution location')
      expect(textOf(entry)).not.toContain('Docker container')
    }
  })

  it('resets to the launch directory on a real location change and does not claim the worktree is retained', () => {
    for (const drafts of [
      [...BASE, ENTERED, TO_DOCKER],
      [...BASE, ENTERED, TO_DOCKER, TO_HOST],
    ]) {
      const note = noteOf(assembleWith({ drafts }))

      expect(note).toContain(`Project directory: ${LAUNCH}.`)
      expect(note).not.toContain(TREE)
      expect(note).not.toContain('git worktree')
    }
  })

  it('keeps every conversation message identical as the tail reminders change', () => {
    const withReminders = assembleWith({ drafts: [...BASE, ENTERED, TO_DOCKER] })
    const later = assembleWith({
      drafts: [...BASE, ENTERED, TO_DOCKER, TO_HOST, { type: 'user-said', text: 'continue' }],
    })

    expect(withoutNote(later.messages).slice(0, 2)).toEqual(
      withoutNote(withReminders.messages).slice(0, 2),
    )
  })

  it('sends the workspace note once, and the same list twice, for one log', () => {
    const first = assembleWith({ drafts: [...BASE, ENTERED] })
    const second = assembleWith({ drafts: [...BASE, ENTERED] })

    expect(notesOf(first.messages)).toHaveLength(1)
    expect(second.messages).toEqual(first.messages)
  })
})

describe('the cache prefix across Host to Docker to Host', () => {
  const conversation = conversationOf(60)
  const marksIn = (messages: readonly unknown[]): number =>
    messages.filter((entry) => JSON.stringify(entry).includes('cacheControl')).length

  it('holds the system and every conversation message byte-identical through real location events', () => {
    expect(conversation.filter((draft) => draft.type !== 'location-changed')).toHaveLength(121)

    const onHost = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inDocker = assembleWith({
      drafts: [...conversation, TO_DOCKER],
      provider: CACHING_PROVIDER,
    })
    const backOnHost = assembleWith({
      drafts: [...conversation, TO_DOCKER, TO_HOST],
      provider: CACHING_PROVIDER,
    })

    const prefixOf = (assembled: Assembled): string =>
      JSON.stringify({ system: assembled.system, conversation: shapeOf(assembled.messages) })

    expect(JSON.stringify(onHost.system)).toContain('cacheControl')
    expect(marksIn(onHost.messages)).toBeGreaterThan(0)
    expect(prefixOf(inDocker)).toBe(prefixOf(onHost))
    expect(prefixOf(backOnHost)).toBe(prefixOf(onHost))
  })

  it('keeps every conversation message identical when the location changes, leaving the note as the only difference', () => {
    const onHost = assembleWith({ drafts: conversation, provider: CACHING_PROVIDER })
    const inDocker = assembleWith({
      drafts: [...conversation, TO_DOCKER],
      provider: CACHING_PROVIDER,
    })

    expect(shapeOf(inDocker.messages)).toEqual(shapeOf(onHost.messages))
    expect(notesOf(inDocker.messages)).toHaveLength(1)
    expect(noteOf(inDocker)).toContain('Execution location: a Docker sandbox')
    expect(noteOf(onHost)).not.toContain('Execution location')
  })
})
