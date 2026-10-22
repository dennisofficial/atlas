import { describe, expect, it } from 'bun:test'

import {
  defaultPipeline,
  EAgentStatus,
  EEffort,
  PromptFragment,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  CLAUDE,
  GPT,
  keyOf,
} from '../../../composition/__tests__/child-model-fixtures'
import { InMemoryPromptRegistry } from '../../../prompt/registry'
import type { AgentType } from '../../types'
import type { ChildRunnerDeps } from '../child-runner'
import { subAgentPrompt } from '../child-prompt'
import { agentTypeNamed } from './fixtures'
import { LAUNCH, openLifetimeSupervisor, type LifetimeOpened } from './model-lifetime-fixture'

const explorer = (): AgentType => agentTypeNamed({ name: 'explore' })
const teammate = (): AgentType => agentTypeNamed({ name: 'teammate' })

class ProviderLineFragment extends PromptFragment {
  readonly id = 'spec.provider-line'

  text(ctx: { provider: { id: string } }): string {
    return `provider is ${ctx.provider.id}`
  }
}

const assemblyFor: ChildRunnerDeps['assemblyFor'] = ({ agentType, model }) =>
  defaultPipeline({
    prompt: () =>
      subAgentPrompt({
        prompts: new InMemoryPromptRegistry([new ProviderLineFragment()]),
        agentType,
        provider: model.identity,
        model: { contextWindow: 200_000 },
        projectDirectory: LAUNCH,
      }),
    launchDirectory: LAUNCH,
  })

const open = (agentTypes: readonly AgentType[]): Promise<LifetimeOpened> =>
  openLifetimeSupervisor({ agentTypes, assemblyFor })

async function spawnChild(opened: LifetimeOpened, args: { agentType: string; threadId?: ThreadId }): Promise<ThreadId> {
  const outcome = await opened.supervisor.spawn({
    threadId: args.threadId ?? opened.main,
    agentType: args.agentType,
    brief: 'finish the task',
    intent: 'work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

describe('a subagent whose parent switches model mid-lifetime', () => {
  it('keeps its spawn-time model on every later step, while the roster and fresh children move on', async () => {
    const opened = await open([explorer()])
    const { supervisor, main, adapters, parent } = opened
    adapters.anthropic.setScript([{ text: 'first, on claude' }, { text: 'second, still claude' }])
    adapters.openai.setScript([{ text: 'a fresh child, on gpt' }])

    const agentId = await spawnChild(opened, { agentType: 'explore' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(opened.persistedBeforeBuild).toEqual([agentId])
    expect(await opened.savedModel(agentId)).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })
    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(1)
    expect(supervisor.list({ threadId: main })[0]?.model).toEqual({
      id: 'anthropic',
      modelId: CLAUDE.modelId,
    })
    const opening = adapters.anthropic.mock.doStreamCalls[0]?.prompt[0]
    expect(opening?.role === 'system' ? opening.content : '').toContain('provider is anthropic')

    parent.select({ ref: GPT, effort: EEffort.High })

    await supervisor.say({ agentId, threadId: main, text: 'keep going' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built).toHaveLength(2)
    expect(adapters.anthropic.built[1]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(2)
    expect(adapters.openai.built).toHaveLength(0)
    expect(supervisor.list({ threadId: main })[0]?.model).toEqual({
      id: 'anthropic',
      modelId: CLAUDE.modelId,
    })
    const resumedPrompt = adapters.anthropic.mock.doStreamCalls[1]?.prompt[0]
    expect(resumedPrompt?.role === 'system' ? resumedPrompt.content : '').toContain('provider is anthropic')

    const freshId = await spawnChild(opened, { agentType: 'explore' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(opened.persistedBeforeBuild).toEqual([agentId, agentId, freshId])
    expect(await opened.savedModel(freshId)).toEqual({ ref: keyOf(GPT), effort: EEffort.High })
    expect(adapters.openai.built).toHaveLength(1)
    expect(adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(1)

    await opened.close()
  })

  it('rebuilds its runner against the saved model when a dead child is resumed after the parent switched', async () => {
    const opened = await open([explorer()])
    const { supervisor, main, adapters, parent } = opened
    adapters.anthropic.setScript([{ error: new Error('the provider went away') }, { text: 'back from the dead' }])
    adapters.openai.setScript([{ text: 'the parent choice, untouched' }])

    const agentId = await spawnChild(opened, { agentType: 'explore' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(supervisor.list({ threadId: main })[0]?.status).toBe(EAgentStatus.Failed)

    parent.select({ ref: GPT, effort: EEffort.Low })

    const resumed = await supervisor.resume({ agentId, threadId: main })
    expect(resumed.ok).toBe(true)
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built).toHaveLength(2)
    expect(adapters.anthropic.built[1]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(2)
    expect(adapters.openai.built).toHaveLength(0)
    expect(supervisor.list({ threadId: main })[0]?.status).toBe(EAgentStatus.Finished)

    await opened.close()
  })
})

describe("a teammate's descendants", () => {
  it("inherit the teammate's saved choice even after main switches model", async () => {
    const opened = await open([explorer(), teammate()])
    const { supervisor, main, adapters, parent } = opened
    adapters.anthropic.setScript([{ text: 'the teammate, on claude' }, { text: 'the descendant, still claude' }])
    adapters.openai.setScript([{ text: 'gpt, never reached' }])

    const teammateId = await spawnChild(opened, { agentType: 'teammate' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(await opened.savedModel(teammateId)).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })

    parent.select({ ref: GPT, effort: EEffort.Low })

    const builderId = await spawnChild(opened, { agentType: 'explore', threadId: teammateId })
    await supervisor.whenChildrenSettled({ threadId: teammateId })

    expect(await opened.savedModel(builderId)).toEqual({ ref: keyOf(CLAUDE), effort: EEffort.Medium })
    expect(adapters.anthropic.built).toHaveLength(2)
    expect(adapters.anthropic.built[1]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(2)
    expect(adapters.openai.built).toHaveLength(0)

    await opened.close()
  })
})
