import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  toThreadId,
  type ClassifierOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext, PodClassifier } from '@dltech/atlas-plugin-sdk'

import { skillsResource } from '../resources'
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

const OPTIONS = { cloud: () => fakeCloud({ entries: [] }) }

type Answer = (questions: readonly string[]) => Promise<ClassifierOutcome>

const fakeClassifier = (args: {
  on?: boolean
  answer: Answer
}): PodClassifier & { calls: number } => {
  const fake = {
    calls: 0,
    status: () =>
      args.on === false ? { on: false as const, reason: 'off' } : { on: true as const, model: 'm' },
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

const rig = async (args: {
  classifier: PodClassifier
  catalogue?: boolean
  extra?: readonly Record<string, unknown>[]
}) => {
  const daemon = fakeDaemon(TREE)
  const ctx: PluginPodContext = { ...daemon.ctx, classifier: args.classifier }
  if (args.catalogue !== false) {
    const resource = skillsResource(OPTIONS)
    const value = await resource.load({ ctx, directory: '/repo' })
    await ctx.append([
      { type: 'resource-loaded', resource: resource.name, fingerprint: 'f', value },
    ])
  }
  const events = daemon.events
  events.push({ type: 'user-said', text: 'make a demo clip of this PR' } as V2Event)
  for (const body of args.extra ?? []) events.push(body as unknown as V2Event)
  const hook = skillsSuggestionHook({ ctx, options: OPTIONS })
  return await hook.run({ threadId: toThreadId('t'), projectDirectory: '/repo' })
}

describe('the skill suggestion hook', () => {
  it('names the winning skill in one context-loaded draft', async () => {
    const outcome = await rig({ classifier: fakeClassifier({ answer: confident }) })
    expect(outcome.drafts).toEqual([
      {
        type: 'context-loaded',
        slot: 'skill-suggestion',
        key: 'latest',
        content: 'skill: clipper — 0.88',
      },
    ])
  })

  it('suggests for a message still in the inbox and ties the draft to it', async () => {
    const classifier = fakeClassifier({ answer: confident })
    const daemon = fakeDaemon(TREE)
    const ctx: PluginPodContext = { ...daemon.ctx, classifier }
    const resource = skillsResource(OPTIONS)
    const value = await resource.load({ ctx, directory: '/repo' })
    await ctx.append([
      { type: 'resource-loaded', resource: resource.name, fingerprint: 'f', value },
    ])
    daemon.events.push({
      type: 'input-posted',
      inboxId: 4,
      kind: 'message',
      postedAt: '',
      message: { text: 'make a demo clip of this PR' },
    } as unknown as V2Event)
    const hook = skillsSuggestionHook({ ctx, options: OPTIONS })
    const outcome = await hook.run({ threadId: toThreadId('t'), projectDirectory: '/repo' })
    expect(outcome.drafts?.[0]).toMatchObject({
      content: 'skill: clipper — 0.88',
      triggeredBy: 'inbox:4',
    })
  })

  it('makes no request while the classifier is off', async () => {
    const classifier = fakeClassifier({ on: false, answer: confident })
    expect(await rig({ classifier })).toEqual({})
    expect(classifier.calls).toBe(0)
  })

  it('makes no request when the per-turn setting is off', async () => {
    const classifier = fakeClassifier({ answer: confident })
    const daemon = fakeDaemon(TREE)
    const ctx: PluginPodContext = { ...daemon.ctx, classifier }
    daemon.events.push({ type: 'user-said', text: 'make a demo clip' } as V2Event)
    const hook = skillsSuggestionHook({ ctx, options: { ...OPTIONS, suggests: async () => false } })
    expect(await hook.run({ threadId: toThreadId('t'), projectDirectory: '/repo' })).toEqual({})
    expect(classifier.calls).toBe(0)
  })

  it('stays quiet when the message already has a suggestion', async () => {
    const classifier = fakeClassifier({ answer: confident })
    const extra = [
      { type: 'context-loaded', slot: 'skill-suggestion', key: 'latest', content: 'x' },
    ]
    expect(await rig({ classifier, extra })).toEqual({})
    expect(classifier.calls).toBe(0)
  })

  it('stays quiet when the classifier fails or rejects', async () => {
    const failed = fakeClassifier({
      answer: async () => ({ ok: false, fault: EClassifierFault.Aborted, detail: 'deadline' }),
    })
    expect(await rig({ classifier: failed })).toEqual({})
    const rejecting = fakeClassifier({
      answer: async () => {
        throw new DOMException('aborted', 'AbortError')
      },
    })
    expect(await rig({ classifier: rejecting })).toEqual({})
  })

  it('stays quiet without a catalogue snapshot', async () => {
    const classifier = fakeClassifier({ answer: confident })
    expect(await rig({ classifier, catalogue: false })).toEqual({})
    expect(classifier.calls).toBe(0)
  })
})
