import { afterEach, describe, expect, it } from 'bun:test'

import {
  defaultPipeline,
  EAgentStatus,
  EEffort,
  EKilledBy,
  PromptFragment,
  type ThreadId,
} from '@dltech/atlas-core'
import { createRemoteDeltaChannel, RemoteThreadStore, type RemoteDeltaChannel } from '@dltech/atlas-harness'
import type { RosterWire } from '@dltech/atlas-wire'

import { agentTypeNamed } from '../../../../packages/harness/src/agents/registry/__tests__/fixtures'
import {
  LAUNCH,
  openLifetimeSupervisor,
  type LifetimeAdapter,
  type LifetimeOpened,
} from '../../../../packages/harness/src/agents/registry/__tests__/model-lifetime-fixture'
import { subAgentPrompt } from '../../../../packages/harness/src/agents/registry/child-prompt'
import type { ChildRunnerDeps } from '../../../../packages/harness/src/agents/registry/child-runner'
import { CLAUDE, GPT, keyOf } from '../../../../packages/harness/src/composition/__tests__/child-model-fixtures'
import { InMemoryPromptRegistry } from '../../../../packages/harness/src/prompt/registry'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { fakeServeApp } from './fakes'

const TOKEN = 'child-runner-retarget'
const PICK = { ref: keyOf(GPT), effort: EEffort.High }
const SPAWNED = { ref: keyOf(CLAUDE), effort: EEffort.Medium }

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

type Cloud = {
  opened: LifetimeOpened
  channel: RemoteDeltaChannel
  threads: RemoteThreadStore
  rosterWithChildOn: (args: { agentId: ThreadId; modelId: string }) => Promise<RosterWire>
}

const closers: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

async function attach(): Promise<Cloud> {
  const opened = await openLifetimeSupervisor({
    agentTypes: [agentTypeNamed({ name: 'explore' })],
    assemblyFor,
  })
  closers.push(opened.close)
  const heldHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = opened.home
  closers.push(() => {
    if (heldHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = heldHome
  })

  const base = fakeServeApp({ threadId: opened.main, root: '/workspace' })
  const serve: ServeHandle = await startServe({
    threadId: opened.main,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: { ATLAS_HOME: opened.home },
    cwd: '/workspace',
    compose: async () => ({
      ...base,
      threads: opened.threads,
      log: opened.log,
      ledger: opened.ledger,
      whenChildrenSettled: ({ threadId }) => opened.supervisor.whenChildrenSettled({ threadId }),
      roster: {
        snapshot: () => ({ shells: [], agents: [...opened.supervisor.listEverywhere()], services: [] }),
        subscribe: (listener) => opened.supervisor.onChange(listener),
      },
    }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  closers.push(() => serve.close())

  const channel = createRemoteDeltaChannel({
    threadId: opened.main,
    url: `http://127.0.0.1:${serve.port}`,
    token: TOKEN,
    maxAttempts: 0,
  })
  closers.push(() => channel.close())
  await new Promise<void>((resolve, reject) => {
    const offReady = channel.onReady(() => {
      offReady()
      offError()
      resolve()
    })
    const offError = channel.onError(({ message }) => reject(new Error(message)))
  })

  const rosterWithChildOn: Cloud['rosterWithChildOn'] = ({ agentId, modelId }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no roster showed ${agentId} on ${modelId}`)), 2_000)
      const off = channel.onRoster((roster) => {
        if (roster.agents.find((agent) => agent.agentId === agentId)?.model?.modelId !== modelId) return
        clearTimeout(timer)
        off()
        resolve(roster)
      })
    })

  return { opened, channel, threads: new RemoteThreadStore({ channel }), rosterWithChildOn }
}

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

const systemPromptOf = (mock: LifetimeAdapter['mock'], call: number): string => {
  const opening = mock.doStreamCalls[call]?.prompt[0]
  return opening?.role === 'system' ? opening.content : ''
}

const statusOf = (opened: LifetimeOpened, agentId: ThreadId): EAgentStatus | undefined =>
  opened.supervisor.list({ threadId: opened.main }).find((agent) => agent.agentId === agentId)?.status

describe('an operator retargeting a supervised child over the cloud channel', () => {
  it('leaves the active runner on its old model, then rebuilds the next run on the pick', async () => {
    const { opened, threads, rosterWithChildOn } = await attach()
    const { supervisor, main, adapters } = opened
    adapters.anthropic.setScript([{ text: 'finished on claude' }])
    adapters.openai.setScript([{ text: 'next run, on gpt' }])

    const held = adapters.anthropic.holdNext()
    const childId = await spawnChild(opened)
    await held.reached

    const rostered = rosterWithChildOn({ agentId: childId, modelId: GPT.modelId })
    await threads.chooseModel({ threadId: childId, model: PICK, retarget: true })
    const roster = await rostered

    expect(roster.agents.find((agent) => agent.agentId === childId)?.model).toEqual({
      id: 'openai',
      modelId: GPT.modelId,
    })
    expect(await opened.savedModel(childId)).toEqual(PICK)
    expect((await threads.find({ threadId: childId }))?.model).toEqual(PICK)
    expect(statusOf(opened, childId)).toBe(EAgentStatus.Running)
    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.openai.built).toHaveLength(0)

    held.release()
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Finished)
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(1)
    expect(adapters.anthropic.built[0]?.effortAt()).toBe(EEffort.Medium)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(0)

    const said = await supervisor.say({ agentId: childId, threadId: main, text: 'next' })
    expect(said.ok).toBe(true)
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built).toHaveLength(1)
    expect(adapters.openai.built).toHaveLength(1)
    expect(adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(1)
    expect(systemPromptOf(adapters.openai.mock, 0)).toContain('provider is openai')
    expect(await opened.savedModel(childId)).toEqual(PICK)
  })

  it('rebuilds a stopped child on the pick and leaves the parent and a sibling alone', async () => {
    const { opened, threads, rosterWithChildOn } = await attach()
    const { supervisor, main, adapters, parent } = opened
    adapters.anthropic.setScript([{ text: 'the sibling' }, { text: 'the sibling again' }])
    adapters.openai.setScript([{ text: 'the retargeted child' }])

    const siblingId = await spawnChild(opened)
    await supervisor.whenChildrenSettled({ threadId: main })

    const held = adapters.anthropic.holdNext()
    const childId = await spawnChild(opened)
    await held.reached
    supervisor.stop({ agentId: childId, threadId: main, by: EKilledBy.User })
    await supervisor.whenChildrenSettled({ threadId: main })
    expect(statusOf(opened, childId)).toBe(EAgentStatus.Stopped)

    const rostered = rosterWithChildOn({ agentId: childId, modelId: GPT.modelId })
    await threads.chooseModel({ threadId: childId, model: PICK, retarget: true })
    const roster = await rostered

    expect(roster.agents.find((agent) => agent.agentId === siblingId)?.model?.modelId).toBe(CLAUDE.modelId)
    expect(await opened.savedModel(childId)).toEqual(PICK)
    expect(await opened.savedModel(siblingId)).toEqual(SPAWNED)
    expect(parent.choice()).toEqual({ ref: CLAUDE, effort: EEffort.Medium })
    expect(adapters.openai.built).toHaveLength(0)

    await supervisor.say({ agentId: childId, threadId: main, text: 'carry on' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(statusOf(opened, childId)).toBe(EAgentStatus.Finished)
    expect(adapters.openai.built).toHaveLength(1)
    expect(adapters.openai.built[0]?.effortAt()).toBe(EEffort.High)
    expect(adapters.openai.mock.doStreamCalls).toHaveLength(1)
    expect(systemPromptOf(adapters.openai.mock, 0)).toContain('provider is openai')
    expect(adapters.anthropic.mock.doStreamCalls).toHaveLength(2)

    await supervisor.say({ agentId: siblingId, threadId: main, text: 'and you?' })
    await supervisor.whenChildrenSettled({ threadId: main })

    expect(adapters.anthropic.built[2]?.effortAt()).toBe(EEffort.Medium)
    expect(systemPromptOf(adapters.anthropic.mock, 2)).toContain('provider is anthropic')
    expect(adapters.openai.built).toHaveLength(1)
  })
})
