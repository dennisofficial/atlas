import {
  EToolEffect,
  ToolDefinition,
  type ModelPort,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import {
  composePlugins,
  definePlugin,
  type MessageSent,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { z } from 'zod'

import { flushUntil, makeRig, seedSession, THREAD_ID } from '../../__tests__/holder-rig'

export const A_BRIEF = 'CREW-BRIEF-FIRST ask the sibling'
export const B_BRIEF = 'CREW-BRIEF-SECOND answer your sibling'
export const ASK = 'CREW-ASK the parser is yours'
export const ANSWER = 'CREW-ANSWER understood, taking it'
export const ECHO = 'CREW-ECHO good, report when done'
export const PARENT_SAY = 'CREW-PARENT steer the first sub-agent'

export const SPAWN_B = 'crew_spawn_b'
export const SPAWN_A = 'crew_spawn_a'
export const ASK_PROBE = 'crew_ask_probe'
export const ANSWER_PROBE = 'crew_answer_probe'
export const ECHO_PROBE = 'crew_echo_probe'
export const PARENT_SAY_PROBE = 'crew_parent_say_probe'

export type SiblingState = {
  aId: string | undefined
  bId: string | undefined
  asked: MessageSent | undefined
  answered: MessageSent | undefined
  echoed: MessageSent | undefined
  told: MessageSent | undefined
}

class ParentSayProbe extends ToolDefinition {
  readonly name = PARENT_SAY_PROBE
  readonly description = 'message the first sub-agent from the main agent'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SiblingState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const aId = this.state.aId
    if (aId === undefined) throw new Error('the first sub-agent was not spawned')
    this.state.told = await this.ctx.messages.send({ to: aId, text: PARENT_SAY })
    return { ok: true, output: { to: aId }, modelText: 'steered the first sub-agent' }
  }
}

const lastReporterOf = (events: readonly V2Event[]): string | undefined => {
  const reported = events.filter((event) => event.type === 'agent-reported').at(-1)
  return reported?.type === 'agent-reported' ? reported.agentId : undefined
}

class SpawnProbe extends ToolDefinition {
  readonly name: string
  readonly description: string
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SiblingState,
    args: {
      name: string
      description: string
      intent: string
      slot: 'aId' | 'bId'
      brief: () => string
    },
  ) {
    super()
    this.name = args.name
    this.description = args.description
    this.intent = args.intent
    this.slot = args.slot
    this.brief = args.brief
  }

  private readonly intent: string
  private readonly slot: 'aId' | 'bId'
  private readonly brief: () => string

  async invoke(): Promise<ToolOutcome> {
    const snapshot = await this.ctx.crew.spawn({
      agentType: 'general-purpose',
      intent: this.intent,
      prompt: this.brief(),
    })
    this.state[this.slot] = snapshot.agentId
    return { ok: true, output: { agentId: snapshot.agentId }, modelText: 'spawned' }
  }
}

class AskProbe extends ToolDefinition {
  readonly name = ASK_PROBE
  readonly description = 'message the sibling sub-agent by its id'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SiblingState,
  ) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    const bId = this.state.bId
    if (bId === undefined || this.state.asked !== undefined) {
      return { ok: true, output: {}, modelText: 'nothing to ask' }
    }
    this.state.asked = await this.ctx.messages.send({ to: bId, text: ASK })
    return { ok: true, output: { to: bId }, modelText: 'asked the sibling' }
  }
}

class ReporterProbe extends ToolDefinition {
  readonly name: string
  readonly description = 'answer the sub-agent that reported to me'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({})

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SiblingState,
    args: { name: string; text: string; slot: 'answered' | 'echoed' },
  ) {
    super()
    this.name = args.name
    this.text = args.text
    this.slot = args.slot
  }

  private readonly text: string
  private readonly slot: 'answered' | 'echoed'

  async invoke(): Promise<ToolOutcome> {
    const to = lastReporterOf(this.ctx.events())
    if (to === undefined || this.state[this.slot] !== undefined) {
      return { ok: true, output: {}, modelText: 'nothing to answer' }
    }
    this.state[this.slot] = await this.ctx.messages.send({ to, text: this.text })
    return { ok: true, output: { to }, modelText: 'answered the sibling' }
  }
}

const siblingPlugin = (state: SiblingState): Plugin =>
  definePlugin({
    name: 'sibling-probe',
    events: [],
    views: [],
    commands: [],
    pod: {
      childDeny: [SPAWN_A, SPAWN_B, PARENT_SAY_PROBE],
      tools: (ctx) => [
        new SpawnProbe(ctx, state, {
          name: SPAWN_B,
          description: 'spawn the second sub-agent',
          intent: 'answer the sibling',
          slot: 'bId',
          brief: () => B_BRIEF,
        }),
        new SpawnProbe(ctx, state, {
          name: SPAWN_A,
          description: 'spawn the first sub-agent with its sibling id',
          intent: 'ask the sibling',
          slot: 'aId',
          brief: () => {
            const bId = state.bId
            if (bId === undefined) throw new Error('the second sub-agent was not spawned')
            return `${A_BRIEF} ${bId}`
          },
        }),
        new ParentSayProbe(ctx, state),
        new AskProbe(ctx, state),
        new ReporterProbe(ctx, state, { name: ANSWER_PROBE, text: ANSWER, slot: 'answered' }),
        new ReporterProbe(ctx, state, { name: ECHO_PROBE, text: ECHO, slot: 'echoed' }),
      ],
      prompts: [],
    },
    control: { hooks: [], commands: new Map() },
    client: { hooks: [] },
    transport: 'none',
  })

export const idle = { text: 'idle' } as const

export const siblingRig = async (args: {
  parent: readonly ScriptedModelStep[]
  first: readonly ScriptedModelStep[]
  second: readonly ScriptedModelStep[]
}) => {
  const state: SiblingState = {
    aId: undefined,
    bId: undefined,
    asked: undefined,
    answered: undefined,
    echoed: undefined,
    told: undefined,
  }
  const parent = new ScriptedModel(args.parent)
  const first = new ScriptedModel(args.first)
  const second = new ScriptedModel(args.second)
  const model: ModelPort = {
    identity: parent.identity,
    step: async ({ assembled, tools, signal, onChunk }) => {
      const step = { assembled, tools, signal, ...(onChunk === undefined ? {} : { onChunk }) }
      const text = JSON.stringify(assembled)
      if (text.includes(A_BRIEF)) return first.step(step)
      if (text.includes(B_BRIEF)) return second.step(step)
      return parent.step(step)
    },
  }
  const rig = await makeRig({
    plugins: composePlugins([siblingPlugin(state)]),
    model: () => model,
  })
  await seedSession(rig)
  await rig.holder.start()
  return { rig, state, first }
}

export const eventsIn = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  threadId: string,
): Promise<V2Event[]> =>
  (
    await rig.plane.readEvents({
      threadId: threadId as typeof THREAD_ID,
      afterSeq: 0,
      limit: 500,
      visible: false,
    })
  ).events

export const reportedOn = (events: readonly V2Event[], threadId: string, prose: string) =>
  events.find(
    (event) =>
      event.type === 'agent-reported' && event.agentId === threadId && event.prose === prose,
  )

export const arrivesOn = async (args: {
  rig: Awaited<ReturnType<typeof makeRig>>
  threadId: () => string
  from: () => string
  prose: string
}): Promise<V2Event[]> => {
  const arrived = await flushUntil({
    check: async () =>
      reportedOn(await eventsIn(args.rig, args.threadId()), args.from(), args.prose) !== undefined,
    clock: args.rig.clock,
    advanceMs: 60_000,
    attempts: 200,
  })
  if (!arrived) throw new Error(`no message ${args.prose} arrived`)
  return await eventsIn(args.rig, args.threadId())
}
