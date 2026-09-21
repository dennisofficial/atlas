import { z } from 'zod'

import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolDeclaration,
  type ToolDefinition,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { AgentSnapshot } from '../../agents/registry/snapshot'
import { AGENT_SPAWN_TOOL_NAME, isTeammateType, type AgentType } from '../../agents/types/agent-type'
import { ToolRegistry } from '../registry'
import type { AgentRegistrySource } from './agent-tokens'

const inputSchema = z.strictObject({
  agentType: z.string().min(1),
  intent: z.string().min(1),
  brief: z.string().min(1),
})

const PROSE = [
  'Start a sub-agent: a second agent with its own conversation and its own context window, working on one task you hand it.',
  'It has the same tools you have and cannot spawn sub-agents of its own.',
  'It runs in the background, so this returns its agentId at once and its answer reaches you on its own when it stops; never poll for it.',
  'brief is the whole of what it will ever know about the task, because it does not read your conversation: state the goal, the files and facts it needs, and what to report back.',
  'intent is one short line naming what it is doing, which is how you and the person watching tell your agents apart.',
  'Delegate work that is worth a fresh context window — a search across many files, a self-contained change, a review — and keep work you are already holding the context for.',
  'One call starts exactly one agent. To run several at once, emit several agent_spawn calls in one turn, each with its own full brief — and when several make changes at once, give each a disjoint set of files to own.',
].join(' ')

const TEAMMATE_NOTE =
  'The teammate type is the exception: a full session that works beside you rather than under you, which only the main session may spawn.'

function typeListing(types: readonly AgentType[]): string {
  if (types.length === 0) return 'No agent type is registered, so nothing can be spawned yet.'

  return [
    'The types you may pass as agentType:',
    ...types.map((type) => `- ${type.name}: ${type.whenToUse}`),
  ].join('\n')
}

export const describeSpawn = (types: readonly AgentType[]): string =>
  [
    types.some((type) => isTeammateType(type.name)) ? `${PROSE} ${TEAMMATE_NOTE}` : PROSE,
    typeListing(types),
  ].join('\n\n')

const lineFor = (snapshot: AgentSnapshot): string =>
  `${snapshot.agentId}  ${snapshot.agentType}  ${snapshot.intent}`

export class AgentSpawnTool extends SchemaTool<typeof inputSchema> {
  readonly name = AGENT_SPAWN_TOOL_NAME
  readonly description: string
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS
  override readonly isConcurrencySafe = (): boolean => true

  constructor(
     private readonly agents: AgentRegistrySource,
    private readonly types: readonly AgentType[],
  ) {
    super()
    this.description = describeSpawn(types)
  }

  withoutListedTypes(hidden: readonly string[]): ToolDefinition {
    const visible = this.types.filter((type) => !hidden.includes(type.name))
    if (visible.length === this.types.length) return this

    return new AgentSpawnTool(this.agents, visible)
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const outcome = await this.agents().spawn({ threadId, ...input })
    if (!outcome.ok) return outcome

    const { snapshot } = outcome
    return {
      ok: true,
      output: {
        agentId: snapshot.agentId,
        agentType: snapshot.agentType,
        intent: snapshot.intent,
      },
      modelText: [
        isTeammateType(snapshot.agentType) ? 'Started a teammate.' : 'Started a sub-agent.',
        lineFor(snapshot),
        'It runs in the background, and hands you its answer the moment it stops.',
      ].join('\n'),
    }
  }
}

class SpawnListingHiddenRegistry extends ToolRegistry {
  private readonly registry: ToolRegistry
  private readonly hidden: readonly string[]

  constructor(args: { registry: ToolRegistry; hidden: readonly string[] }) {
    super()
    this.registry = args.registry
    this.hidden = args.hidden
  }

  declarations(): readonly ToolDeclaration[] {
    return this.registry
      .declarations()
      .map((declaration) =>
        declaration instanceof AgentSpawnTool
          ? declaration.withoutListedTypes(this.hidden)
          : declaration,
      )
  }

  find(name: string): ToolDefinition | undefined {
    const found = this.registry.find(name)
    if (found instanceof AgentSpawnTool) return found.withoutListedTypes(this.hidden)
    return found
  }
}

export function withoutSpawnableListing(args: {
  registry: ToolRegistry
  hidden: readonly string[]
}): ToolRegistry {
  return new SpawnListingHiddenRegistry(args)
}
