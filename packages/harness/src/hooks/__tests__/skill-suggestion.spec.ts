import { describe, expect, it } from 'bun:test'

import {
  DecisionPort,
  EDefinitionOrigin,
  EventLogPort,
  SKILL_SUGGEST_WHICH_KEY,
  toEventId,
  toRunId,
  toThreadId,
  type DecisionOutcome,
  type DecisionQuestion,
  type Event,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import type { SkillRegistryPort } from '../../skills/port'
import { parseSkill, type DiscoveredSkill } from '../../skills/skill'
import { SkillSuggestionHook } from '../skill-suggestion'

class MemoryLog extends EventLogPort {
  private readonly events = new Map<string, Event[]>()
  private seq = 0

  async append(args: {
    threadId: ThreadId
    runId: ReturnType<typeof toRunId>
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    const held = this.events.get(args.threadId) ?? []
    const stamped = args.drafts.map((draft) => {
      this.seq += 1
      return {
        ...draft,
        id: toEventId(`evt_${this.seq}`),
        seq: this.seq,
        threadId: args.threadId,
        runId: args.runId,
        depth: 0,
        at: new Date(this.seq).toISOString(),
      } as Event
    })
    this.events.set(args.threadId, [...held, ...stamped])
    return stamped
  }

  async replace(): Promise<Event[]> {
    throw new Error('not needed')
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.events.get(args.threadId) ?? []
  }

  async head(args: { threadId: ThreadId }): Promise<number> {
    return (this.events.get(args.threadId) ?? []).length
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }
}

class FakeSkills implements SkillRegistryPort {
  constructor(private readonly skills: readonly DiscoveredSkill[]) {}
  all(): readonly DiscoveredSkill[] {
    return this.skills
  }
  byName(name: string): DiscoveredSkill | undefined {
    return this.skills.find((skill) => skill.spec.name === name)
  }
  async reload(): Promise<readonly DiscoveredSkill[]> {
    return this.skills
  }
}

class ScriptedDecisions extends DecisionPort {
  calls = 0
  constructor(private readonly outcomes: readonly DecisionOutcome[]) {
    super()
  }
  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
  }): Promise<DecisionOutcome> {
    this.calls += 1
    const next = this.outcomes[this.calls - 1]
    if (next === undefined) throw new Error('unexpected decide call')
    return next
  }
}

const skill = (name: string): DiscoveredSkill => {
  const parsed = parseSkill({
    text: `---\nname: ${name}\ndescription: ${name} description\n---\n${name} body`,
    fallbackName: name,
    origin: EDefinitionOrigin.User,
  })
  if (parsed === undefined) throw new Error(`expected ${name} to parse`)
  return parsed
}

const THREAD = toThreadId('thread-1')
const RUN = toRunId('run-1')

const wideOutcome: DecisionOutcome = {
  ok: true,
  answers: {
    [SKILL_SUGGEST_WHICH_KEY]: { choice: 'alpha', probabilities: { alpha: 0.9, beta: 0.1 } },
    'gate::acts_on_user_system': { noul: 0.9 },
    'gate::would_follow_documented_procedure': { noul: 0.8 },
    'gate::prose_suffices': { noul: 0.1 },
  },
}

const rerankOutcome: DecisionOutcome = {
  ok: true,
  answers: {
    [SKILL_SUGGEST_WHICH_KEY]: { choice: 'alpha' },
    'fits::alpha': { noul: 0.7 },
    'fits::beta': { noul: 0.2 },
  },
}

const hookWith = (args: {
  log: MemoryLog
  skills: readonly DiscoveredSkill[]
  decisions: DecisionPort
  enabled?: boolean
}): SkillSuggestionHook =>
  new SkillSuggestionHook({
    log: args.log,
    skills: new FakeSkills(args.skills),
    decisions: args.decisions,
    enabled: () => args.enabled ?? true,
  })

const say = async (log: MemoryLog, text: string): Promise<void> => {
  await log.append({ threadId: THREAD, runId: RUN, drafts: [{ type: 'user-said', text }] })
}

describe('SkillSuggestionHook', () => {
  it('stays out of the turn when the feature is disabled', async () => {
    const log = new MemoryLog()
    await say(log, 'build me a pitch deck')
    const decisions = new ScriptedDecisions([wideOutcome, rerankOutcome])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions, enabled: false })

    expect(await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })).toEqual({})
    expect(decisions.calls).toBe(0)
  })

  it('suggests the winning skill for a fresh user message', async () => {
    const log = new MemoryLog()
    await say(log, 'build me a pitch deck')
    const decisions = new ScriptedDecisions([wideOutcome, rerankOutcome])
    const hook = hookWith({ log, skills: [skill('alpha'), skill('beta')], decisions })

    const outcome = await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    expect(outcome.additionalContext).toContain('Relevant to the current request: alpha.')
  })

  it('says when nothing fits rather than leaving the roster pressure unanswered', async () => {
    const log = new MemoryLog()
    await say(log, 'what is a monad?')
    const decisions = new ScriptedDecisions([
      {
        ok: true,
        answers: {
          [SKILL_SUGGEST_WHICH_KEY]: { choice: 'alpha', probabilities: { alpha: 0.9 } },
          'gate::acts_on_user_system': { noul: 0.05 },
          'gate::would_follow_documented_procedure': { noul: 0.1 },
          'gate::prose_suffices': { noul: 0.95 },
        },
      },
    ])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions })

    const outcome = await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    expect(outcome.additionalContext).toContain('No skill in the roster appears relevant')
  })

  it('does not suggest twice for the same message', async () => {
    const log = new MemoryLog()
    await say(log, 'build me a pitch deck')
    const decisions = new ScriptedDecisions([wideOutcome, rerankOutcome])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions })

    await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    expect(await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })).toEqual({})
    expect(decisions.calls).toBe(2)
  })

  it('suggests again once a new message lands', async () => {
    const log = new MemoryLog()
    const decisions = new ScriptedDecisions([wideOutcome, rerankOutcome, wideOutcome, rerankOutcome])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions })

    await say(log, 'build me a pitch deck')
    await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    await say(log, 'now the appendix too')
    const outcome = await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    expect(outcome.additionalContext).toContain('Relevant to the current request: alpha.')
    expect(decisions.calls).toBe(4)
  })

  it('stays silent and retries later when the decision model is unreachable', async () => {
    const log = new MemoryLog()
    await say(log, 'build me a pitch deck')
    const decisions = new ScriptedDecisions([
      { ok: false, fault: 'the decision model answered 529' },
      wideOutcome,
      rerankOutcome,
    ])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions })

    expect(await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })).toEqual({})
    const retried = await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })
    expect(retried.additionalContext).toContain('Relevant to the current request: alpha.')
  })

  it('does nothing without a user message or without skills', async () => {
    const log = new MemoryLog()
    const decisions = new ScriptedDecisions([])
    const hook = hookWith({ log, skills: [skill('alpha')], decisions })
    expect(await hook.run({ threadId: THREAD, projectDirectory: '/tmp' })).toEqual({})

    await say(log, 'build me a pitch deck')
    const skillless = hookWith({ log, skills: [], decisions })
    expect(await skillless.run({ threadId: THREAD, projectDirectory: '/tmp' })).toEqual({})
    expect(decisions.calls).toBe(0)
  })
})
