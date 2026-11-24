import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  ERunFailureKind,
  EToolEffect,
  ToolDefinition,
  credentialRepairOf,
  toAccountId,
  type ModelPort,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  composePlugins,
  definePlugin,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import type { RigRuntime } from './rig-runtime'
import { flushUntil, makeRig, seedSession, THREAD_ID, type HolderRig } from './holder-rig'

const CHILD_BRIEF = 'CREDENTIAL-BRIEF take the first pass'
const SPAWN_PROBE = 'credential_spawn_probe'
const ACCOUNT = toAccountId('account-credential-1')

type ProbeState = { rig?: HolderRig | undefined }

const authFailureOf = (runtime: RigRuntime): void => {
  runtime.normalizeFailure = () => ({
    kind: EProviderFailureKind.Auth,
    scope: EProviderFailureScope.Credential,
    retry: EProviderRetry.Never,
    accountId: ACCOUNT,
    message: 'the credential was rejected',
  })
}

class SpawnProbe extends ToolDefinition {
  readonly name = SPAWN_PROBE
  readonly description = 'spawn a sub-agent through the crew port'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ProbeState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const runtime = this.state.rig?.runtimes[0]
    if (runtime === undefined) throw new Error('the rig has no runtime')
    authFailureOf(runtime)
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: 'credential',
      prompt: CHILD_BRIEF,
    })
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

const probePlugin = (state: ProbeState): Plugin =>
  definePlugin({
    name: 'credential-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_PROBE],
      tools: (ctx) => [new SpawnProbe(ctx, state)],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

const eventsIn = async (rig: HolderRig, threadId: string): Promise<V2Event[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 500,
      visible: false,
    })
  ).events

const endOf = (events: readonly V2Event[]): Extract<V2Event, { type: 'agent-ended' }> | undefined =>
  events.flatMap((event) => (event.type === 'agent-ended' ? [event] : []))[0]

const routedModel = (parent: ScriptedModel, child: ScriptedModel): ModelPort => ({
  identity: parent.identity,
  step: async (args) =>
    JSON.stringify(args.assembled).includes(CHILD_BRIEF) ? child.step(args) : parent.step(args),
})

describe('a sub-agent whose model step fails on its credential', () => {
  it('posts the structured failure on the parent thread, main false', async () => {
    const state: ProbeState = {}
    const parent = new ScriptedModel([
      { calls: [{ callId: 'c1', name: SPAWN_PROBE, input: {} }] },
      { text: 'parent continued' },
    ])
    const child = new ScriptedModel([{ throws: new Error('401 the credential was rejected') }])
    const rig = await makeRig({
      plugins: composePlugins([probePlugin(state)]),
      model: () => routedModel(parent, child),
    })
    state.rig = rig
    await seedSession(rig)
    await rig.holder.start()

    await rig.post('spawn one')
    await rig.wake()
    const ended = await flushUntil({
      check: async () => endOf(await eventsIn(rig, THREAD_ID))?.status === EAgentStatus.Failed,
      clock: rig.clock,
      attempts: 300,
    })
    expect(ended).toBe(true)

    const events = await eventsIn(rig, THREAD_ID)
    const ending = endOf(events)
    if (ending === undefined) throw new Error('no agent-ended on the parent thread')
    expect(ending.failureKind).toBe(ERunFailureKind.Auth)
    expect(ending.failure?.kind).toBe(ERunFailureKind.Auth)
    expect(ending.failure?.accountId).toBe(String(ACCOUNT))

    const repair = credentialRepairOf({ mainThreadId: THREAD_ID, events })
    if (repair === null) throw new Error('the fold found no repair')
    expect(repair.main).toBe(false)
    expect(repair.kind).toBe(ERunFailureKind.Auth)
    expect(repair.accountId).toBe(String(ACCOUNT))
    expect(repair.agents.map((agent) => agent.agentId)).toEqual([ending.agentId])
    expect(JSON.stringify(events)).not.toContain('sk-')
    expect(JSON.stringify(events)).not.toContain('Bearer')
  }, 30_000)
})
