import { describe, expect, it } from 'bun:test'

import { defaultPipeline, EAgentStatus, EEffort, EKilledBy, PromptFragment, type ThreadId } from '@dltech/atlas-core'
import type { MockLanguageModelV4 } from 'ai/test'

import { CLAUDE, GPT, keyOf } from '../../../composition/__tests__/child-model-fixtures'
import { InMemoryPromptRegistry } from '../../../prompt/registry'
import type { AgentType } from '../../types'
import type { ChildRunnerDeps } from '../child-runner'
import { subAgentPrompt } from '../child-prompt'
import { agentTypeNamed } from './fixtures'
import { LAUNCH, openLifetimeSupervisor, type LifetimeOpened } from './model-lifetime-fixture'

const explorer = (): AgentType => agentTypeNamed({ name: 'explore' })

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

const PICK = { ref: keyOf(GPT), effort: EEffort.High }
const SPAWNED = { ref: keyOf(CLAUDE), effort: EEffort.Medium }

const open = (): Promise<LifetimeOpened> =>
  openLifetimeSupervisor({ agentTypes: [explorer()], assemblyFor })

async function spawnChild(opened: LifetimeOpened): Promise<ThreadId> {
  const outcome = await opened.supervisor.spawn({
    threadId: opened.main,
    agentType: 'explore',
    brief: 'finish the task',
    intent: 'work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const systemPromptOf = (mock: MockLanguageModelV4, call: number): string => {
  const opening = mock.doStreamCalls[call]?.prompt[0]
  return opening?.role === 'system' ? opening.content : ''
}

const statusOf = (opened: LifetimeOpened, agentId: ThreadId): EAgentStatus | undefined =>
  opened.supervisor.list({ threadId: opened.main }).find((agent) => agent.agentId === agentId)?.status

const modelOf = (opened: LifetimeOpened, agentId: ThreadId) =>
  opened.supervisor.list({ threadId: opened.main }).find((agent) => agent.agentId === agentId)?.model

describe('a stopped child retargeted to another model', () => {
  it('rebuilds on the picked provider with the picked effort and prompt, leaving parent and sibling alone', async () => {
    const opened = await open()
    const { supervisor, main, adapters, parent } = opened
    adapters.anthropic.setScript([{ text: 'the sibling, on claude' }, { text: 'the sibling again, on claude' }])
    adapters.openai.setScript([{ text: 'the retargeted child, on gpt' }])

    const siblingId = await spawnChild(opened)
    await supervisor.whenChildrenSettled({ threadId: main })

    const held = adapters.anthropic.holdNext()
    const childId = await spawnChild(opened)
    await held.reached
    await supervisor.stop({ agentId: childId, threadId: main, by: EKilledBy.User })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Stopped)
    expect(await opened.savedModel(childId)).toEqual(SPAWNED)
    expect(adapters.openai.built).toHaveLength(0)

    await opened.retarget({ threadId: childId, model: PICK })

    expect(await opened.savedModel(childId)).toEqual(PICK)
    expect(modelOf(opened, childId)).toEqual({ id: 'openai', modelId: GPT.modelId })
    expect(adapters.openai.built).toHaveLength(0)

    const said = await supervisor.say({ agentId: childId, threadId: main, text: 'carry on' })
    expect(said.ok).toBe(true)
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Finished)
    expect(adapters.openai.built).toHaveLength(1)
    expect(adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(1)
    expect(systemPromptOf(adapters.openai.mock, 0)).toContain('provider is openai')
    expect(systemPromptOf(adapters.openai.mock, 0)).not.toContain('provider is anthropic')
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(2)

    expect(parent.choice()).toEqual({ ref: CLAUDE, effort: EEffort.Medium })
    expect(await opened.savedModel(siblingId)).toEqual(SPAWNED)
    expect(modelOf(opened, siblingId)).toEqual({ id: 'anthropic', modelId: CLAUDE.modelId })

    await supervisor.say({ agentId: siblingId, threadId: main, text: 'and you?' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built).toHaveLength(3)
    expect(adapters.anthropic.built[2]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(3)
    expect(systemPromptOf(adapters.anthropic.mock, 2)).toContain('provider is anthropic')
    expect(adapters.openai.built).toHaveLength(1)
    expect(await opened.savedModel(siblingId)).toEqual(SPAWNED)

    await opened.close()
  })
})

describe('a running child retargeted mid-step', () => {
  it('finishes its step uninterrupted on the model it started with, then rebuilds on the pick', async () => {
    const opened = await open()
    const { supervisor, main, adapters } = opened
    adapters.anthropic.setScript([{ text: 'finished on claude' }])
    adapters.openai.setScript([{ text: 'next run, on gpt' }])

    const held = adapters.anthropic.holdNext()
    const childId = await spawnChild(opened)
    await held.reached

    await opened.retarget({ threadId: childId, model: PICK })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Running)
    expect(await opened.savedModel(childId)).toEqual(PICK)
    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.openai.built).toHaveLength(0)

    held.release()
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Finished)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(1)
    expect(adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.openai.built).toHaveLength(0)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(0)
    expect(await opened.savedModel(childId)).toEqual(PICK)

    await supervisor.say({ agentId: childId, threadId: main, text: 'next' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.openai.built).toHaveLength(1)
    expect(adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(1)
    expect(systemPromptOf(adapters.openai.mock, 0)).toContain('provider is openai')

    await opened.close()
  })
})
