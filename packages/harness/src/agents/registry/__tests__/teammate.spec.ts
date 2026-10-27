import { afterEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EPromptAgent,
  EToolEffect,
  PromptFragment,
  type PromptContext,
  type ToolDefinition,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../../channel/delta-channel'
import { AgentSpawnTool } from '../../../tools/builtin/agent-spawn'
import { HookChain } from '../../../hooks/registry'
import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { createTempHome, type TempHome } from '../../../loop/__tests__/temp-home'
import { scriptedModel, type ScriptedStep } from '../../../model/testing/scripted-model'
import { AtlasIdentityFragment } from '../../../prompt/fragments/identity'
import { InMemoryPromptRegistry } from '../../../prompt/registry'
import { InMemoryToolRegistry } from '../../../tools/registry'
import { TEAMMATE_AGENT_TYPE } from '../../types'
import { childRunnerSource } from '../child-runner'
import { subAgentPrompt } from '../child-prompt'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, fakeRunners, finished, loggedOfType, settled } from './fixtures'

const PROJECT_DIRECTORY = '/w'

const TEAMMATE = agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })
const BUILDER = agentTypeNamed({ name: 'builder' })

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function open(agentTypes = [TEAMMATE, BUILDER]) {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [] }),
  })
  opened.push({ harness, temp })

  const runners = fakeRunners()
  const supervisor = new AgentSupervisor({
    log: harness.log,
    threads: harness.threads,
    ids: harness.ids,
    clock: harness.clock,
    agentTypes,
    runners: runners.source,
    launchDirectory: '/launch',
  })
  const parent = (await harness.threads.create({})).id

  return { harness, runners, supervisor, parent }
}

describe('spawning a teammate', () => {
  it('runs from the main session, recorded as a teammate of it', async () => {
    const { harness, supervisor, parent } = await open()

    const outcome = await supervisor.spawn({
      threadId: parent,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own the billing workstream',
      intent: 'billing workstream',
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const thread = await harness.threads.find({ threadId: outcome.snapshot.agentId })
    expect(thread?.agent).toEqual({ spawnedBy: parent, type: TEAMMATE_AGENT_TYPE })
  })

  it('is refused to any agent that is itself spawned, whatever its type', async () => {
    const { supervisor, parent } = await open()

    const child = await supervisor.spawn({
      threadId: parent,
      agentType: 'builder',
      brief: 'build a thing',
      intent: 'a build',
    })
    if (!child.ok) throw new Error(child.reason)
    await settled()

    const fromSubAgent = await supervisor.spawn({
      threadId: child.snapshot.agentId,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own a workstream',
      intent: 'a workstream',
    })
    expect(fromSubAgent.ok).toBe(false)
    expect(fromSubAgent.ok ? '' : fromSubAgent.reason).toMatch(/only the main session/)

    const sibling = await supervisor.spawn({
      threadId: parent,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own a workstream',
      intent: 'a workstream',
    })
    if (!sibling.ok) throw new Error(sibling.reason)
    await settled()

    const fromTeammate = await supervisor.spawn({
      threadId: sibling.snapshot.agentId,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own another workstream',
      intent: 'another workstream',
    })
    expect(fromTeammate.ok).toBe(false)
    expect(fromTeammate.ok ? '' : fromTeammate.reason).toMatch(/only the main session/)
  })

  it('records a bookkeeping ending that does not wake the main session when it finishes', async () => {
    const { harness, runners, supervisor, parent } = await open()
    const outcome = await supervisor.spawn({
      threadId: parent,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own the billing workstream',
      intent: 'billing workstream',
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    await settled()

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(supervisor.threadsAwaitingNotice()).toEqual([])

    const drained = supervisor.drainNotifications({ threadId: parent })
    expect(drained.wakesTurn).toBe(false)
    expect(drained.drafts).toEqual([])
    expect(await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })).toHaveLength(1)
  })
})

describe('a teammate reporting to the main session', () => {
  const spawnTeammate = async (opened: Awaited<ReturnType<typeof open>>) => {
    const outcome = await opened.supervisor.spawn({
      threadId: opened.parent,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own the billing workstream',
      intent: 'billing workstream',
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    await settled()
    return outcome.snapshot.agentId
  }

  it('wakes the main session with a fully attributed report', async () => {
    const opened = await open()
    const agentId = await spawnTeammate(opened)

    const outcome = await opened.supervisor.reportToParent({
      threadId: agentId,
      text: 'billing is migrated',
    })

    expect(outcome.ok).toBe(true)
    expect(opened.supervisor.threadsAwaitingNotice()).toEqual([opened.parent])
    expect(opened.supervisor.pendingNotices({ threadId: opened.parent })).toHaveLength(1)

    expect(opened.supervisor.drainNotifications({ threadId: opened.parent }).drafts).toEqual([])
    const logged = await loggedOfType({
      harness: opened.harness,
      threadId: opened.parent,
      type: 'agent-reported',
    })
    expect(
      logged.map(({ agentId: from, agentType, intent, prose }) => ({
        from,
        agentType,
        intent,
        prose,
      })),
    ).toEqual([
      {
        from: agentId,
        agentType: TEAMMATE_AGENT_TYPE,
        intent: 'billing workstream',
        prose: 'billing is migrated',
      },
    ])
  })

  it('is refused to a sub-agent', async () => {
    const opened = await open()
    const outcome = await opened.supervisor.spawn({
      threadId: opened.parent,
      agentType: 'builder',
      brief: 'build a thing',
      intent: 'a build',
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    await settled()

    const refused = await opened.supervisor.reportToParent({
      threadId: outcome.snapshot.agentId,
      text: 'reporting up',
    })

    expect(refused.ok).toBe(false)
    expect(refused.ok ? '' : refused.reason).toMatch(/not a teammate/)
    expect(opened.supervisor.threadsAwaitingNotice()).toEqual([])
  })

  it('is refused to a thread that runs no agent', async () => {
    const opened = await open()

    const refused = await opened.supervisor.reportToParent({
      threadId: opened.parent,
      text: 'reporting up',
    })

    expect(refused.ok).toBe(false)
    expect(refused.ok ? '' : refused.reason).toMatch(/not a teammate/)
  })
})

describe("a teammate's session", () => {
  class MainOnlyFragment extends PromptFragment {
    readonly id = 'main-only.marker'

    override applies(ctx: PromptContext): boolean {
      return ctx.agent === EPromptAgent.Main
    }

    text(): string {
      return 'Only a full session reads this.'
    }
  }

  function toolNamed(name: string): ToolDefinition {
    return {
      name,
      description: `the ${name} tool`,
      effect: EToolEffect.Read,
      inputSchema: z.object({}),
      invoke: (): Promise<ToolOutcome> =>
        Promise.resolve({ ok: true, output: {}, modelText: `${name} ran` }),
    }
  }

  async function spawnTeammate(args: { script: readonly ScriptedStep[] }) {
    const temp = createTempHome()
    const model = scriptedModel({ script: args.script })
    const harness = await buildHarness({ home: temp.home, model })
    opened.push({ harness, temp })

    const prompts = new InMemoryPromptRegistry([
      new AtlasIdentityFragment(),
      new MainOnlyFragment(),
    ])
    const tools = new InMemoryToolRegistry([
      toolNamed('read'),
      new AgentSpawnTool(() => {
        throw new Error('the listing never resolves the registry')
      }, [TEAMMATE, BUILDER]),
      toolNamed('enter_worktree'),
      toolNamed('execution_location'),
      toolNamed('service_start'),
      toolNamed('read_memory'),
      toolNamed('write_memory'),
      toolNamed('edit_memory'),
      toolNamed('delete_memory'),
    ])

    const supervisor = new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [TEAMMATE],
      runners: childRunnerSource({
        deps: () => ({
          turn: {
            log: harness.log,
            model: harness.model,
            ids: harness.ids,
            assembly: defaultPipeline({
              prompt: () => EMPTY_PROMPT,
              launchDirectory: PROJECT_DIRECTORY,
            }),
            launchDirectory: PROJECT_DIRECTORY,
          },
          tools,
          hooks: new HookChain({}),
          channel: createDeltaChannel(),
          drainNotices: async () => ({ drafts: [], wakesTurn: false }),
          assemblyFor: ({ agentType }) =>
            defaultPipeline({
              prompt: () =>
                subAgentPrompt({
                  prompts,
                  agentType,
                  agent:
                    agentType.name === TEAMMATE_AGENT_TYPE ? EPromptAgent.Main : EPromptAgent.Sub,
                  provider: harness.model.identity,
                  model: { contextWindow: 1_000_000 },
                  projectDirectory: PROJECT_DIRECTORY,
                }),
              launchDirectory: PROJECT_DIRECTORY,
            }),
        }),
      }),
      launchDirectory: PROJECT_DIRECTORY,
    })

    const parent = (await harness.threads.create({})).id
    const outcome = await supervisor.spawn({
      threadId: parent,
      agentType: TEAMMATE_AGENT_TYPE,
      brief: 'own the billing workstream',
      intent: 'billing workstream',
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    await supervisor.whenChildrenSettled({ threadId: parent })

    return { harness, model }
  }

  it('keeps the session-shaping tools a sub-agent is denied, service control included', async () => {
    const { model } = await spawnTeammate({ script: [{ text: 'done' }] })

    expect(model.doStreamCalls[0]?.tools?.map((tool) => tool.name)).toEqual([
      'read',
      'agent_spawn',
      'enter_worktree',
      'execution_location',
      'service_start',
      'read_memory',
      'write_memory',
      'edit_memory',
      'delete_memory',
    ])
  })

  it('is shown a spawn listing that never mentions the teammate type', async () => {
    const { model } = await spawnTeammate({ script: [{ text: 'done' }] })

    const declaration = model.doStreamCalls[0]?.tools?.find((tool) => tool.name === 'agent_spawn')
    if (declaration?.type !== 'function') {
      throw new Error('agent_spawn was not offered as a function tool')
    }
    expect(declaration.description).toContain('builder')
    expect(declaration.description).not.toContain(TEAMMATE_AGENT_TYPE)
  })

  it('compiles the full session prompt, with its contract ahead of the shared fragments', async () => {
    const { model } = await spawnTeammate({ script: [{ text: 'done' }] })

    const system = model.doStreamCalls[0]?.prompt[0]
    const text = system?.role === 'system' ? system.content : ''
    expect(text).toContain(`You are the ${TEAMMATE_AGENT_TYPE} sub-agent.`)
    expect(text).toContain('Only a full session reads this.')
  })
})
