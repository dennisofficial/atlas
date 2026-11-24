import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  type Assembled,
  type ClassifierOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext, PodClassifier } from '@dltech/atlas-plugin-sdk'

import { skillsResource, type SkillsPodOptions } from '../resources'
import { skillsSuggestionHook } from '../suggestion-hook'
import { fakeCloud, fakeDaemon, skillDir } from './support'

const TREE = {
  '/repo': { kind: 'dir' as const },
  '/repo/.agents': { kind: 'dir' as const },
  '/repo/.agents/skills': { kind: 'dir' as const },
  '/repo/.agents/skills/clipper': { kind: 'dir' as const },
  '/repo/.agents/skills/clipper/SKILL.md': {
    kind: 'file' as const,
    text: skillDir('clipper', 'body').replace('description: ', 'description: demo clip '),
  },
}

const OPTIONS: SkillsPodOptions = { cloud: () => fakeCloud({ entries: [] }) }

type Answer = (questions: readonly string[]) => Promise<ClassifierOutcome>

const fakeClassifier = (args: {
  on?: boolean
  answer: Answer
}): PodClassifier & { calls: number } => {
  const fake = {
    calls: 0,
    status: () =>
      args.on === false
        ? { on: false as const, reason: 'off' }
        : { on: true as const, model: 'm', provider: 'jev' },
    classify: async ({ questions }: { questions: Record<string, unknown> }) => {
      fake.calls += 1
      return await args.answer(Object.keys(questions))
    },
  }
  return fake
}

const SCORES: Record<string, number> = { 'fits:clipper': 0.88 }

const confident: Answer = async (questions) => ({
  ok: true,
  model: 'm',
  answers: Object.fromEntries(questions.map((key) => [key, { noul: SCORES[key] ?? 0.1 }])),
})

const EMPTY: Assembled = { system: [], messages: [] }

let seq = 0

const stamped = (body: Record<string, unknown>): V2Event =>
  ({ id: `e${++seq}`, seq, ...body }) as unknown as V2Event

const rig = async (args: {
  classifier: PodClassifier
  catalogue?: boolean
  options?: SkillsPodOptions
  extra?: readonly Record<string, unknown>[]
}) => {
  const daemon = fakeDaemon(TREE)
  const ctx: PluginPodContext = {
    ...daemon.ctx,
    classifier: args.classifier,
    append: async (drafts) => {
      for (const draft of drafts) daemon.events.push(stamped(draft as Record<string, unknown>))
    },
  }
  if (args.catalogue !== false) {
    const resource = skillsResource(OPTIONS)
    const value = await resource.load({ ctx, directory: '/repo' })
    await ctx.append([
      { type: 'resource-loaded', resource: resource.name, fingerprint: 'f', value },
    ])
  }
  daemon.events.push(
    stamped({ type: 'user-said', text: 'make a demo clip of this PR', inboxId: 4 }),
  )
  for (const body of args.extra ?? []) daemon.events.push(stamped(body))
  const before = daemon.events.length
  const hook = skillsSuggestionHook({ ctx, options: args.options ?? OPTIONS })
  const assembled = await hook.run({ assembled: EMPTY, trace: [] })
  const text = assembled.messages
    .flatMap((entry) => (entry.message.role === 'user' ? entry.message.content : []))
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
  return { assembled, appended: daemon.events.slice(before), text }
}

describe('the skill suggestion hook', () => {
  it('records the winner once and shows it to this step', async () => {
    const outcome = await rig({ classifier: fakeClassifier({ answer: confident }) })
    expect(outcome.appended).toMatchObject([
      {
        type: 'context-loaded',
        slot: 'skill-suggestion',
        key: 'latest',
        content: 'skill: clipper — 0.88',
        triggeredBy: 'inbox:4',
      },
    ])
    expect(outcome.assembled.messages).toHaveLength(1)
    expect(outcome.assembled.messages[0]?.origin.eventId).toBe(outcome.appended[0]?.id)
    expect(outcome.text).toContain('skill: clipper — 0.88')
    expect(outcome.text).toContain('source="skill-suggestion"')
  })

  it('makes no request while the classifier is off', async () => {
    const classifier = fakeClassifier({ on: false, answer: confident })
    const outcome = await rig({ classifier })
    expect(outcome.assembled).toBe(EMPTY)
    expect(outcome.appended).toEqual([])
    expect(classifier.calls).toBe(0)
  })

  it('makes no request when the per-turn setting is off', async () => {
    const classifier = fakeClassifier({ answer: confident })
    const outcome = await rig({ classifier, options: { ...OPTIONS, suggests: async () => false } })
    expect(outcome.appended).toEqual([])
    expect(classifier.calls).toBe(0)
  })

  it('stays quiet once the message has a suggestion or a reply', async () => {
    const suggested = fakeClassifier({ answer: confident })
    const extra = [
      { type: 'context-loaded', slot: 'skill-suggestion', key: 'latest', content: 'x' },
    ]
    expect((await rig({ classifier: suggested, extra })).appended).toEqual([])
    const replied = fakeClassifier({ answer: confident })
    const reply = [{ type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] }]
    expect((await rig({ classifier: replied, extra: reply })).appended).toEqual([])
    expect(suggested.calls + replied.calls).toBe(0)
  })

  it('stays quiet when the classifier fails or rejects', async () => {
    const failed = fakeClassifier({
      answer: async () => ({ ok: false, fault: EClassifierFault.Aborted, detail: 'deadline' }),
    })
    expect((await rig({ classifier: failed })).assembled).toBe(EMPTY)
    const rejecting = fakeClassifier({
      answer: async () => {
        throw new DOMException('aborted', 'AbortError')
      },
    })
    expect((await rig({ classifier: rejecting })).assembled).toBe(EMPTY)
  })

  it('stays quiet without a catalogue snapshot', async () => {
    const classifier = fakeClassifier({ answer: confident })
    expect((await rig({ classifier, catalogue: false })).appended).toEqual([])
    expect(classifier.calls).toBe(0)
  })
})
