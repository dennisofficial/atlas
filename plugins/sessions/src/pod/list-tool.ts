import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PeerSessionSummary, PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({})

const description = [
  'List the peer sessions around this one: the session that spawned it, if any, and the peer',
  'sessions it has spawned. Each peer is a full session in the same sandbox and workspace, not a',
  'sub-agent, and each line names its id, its title and whether it is archived.',
].join(' ')

const lineOf = (summary: PeerSessionSummary): string => {
  const title = summary.title ?? 'untitled'
  const state = summary.archivedAt === null ? 'open' : `archived ${summary.archivedAt}`
  return `${summary.sessionId}  ${title}  ${state}`
}

const linesOf = (roster: {
  spawner: PeerSessionSummary | null
  peers: readonly PeerSessionSummary[]
}): string[] => {
  const lines = roster.spawner === null ? [] : [`spawner: ${lineOf(roster.spawner)}`]
  if (roster.peers.length === 0) return [...lines, 'You have spawned no peer sessions.']
  return [...lines, 'peers:', ...roster.peers.map((peer) => `- ${lineOf(peer)}`)]
}

export class ListSessionsTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'list_sessions'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run(_args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const roster = await this.ctx.sessions.list()
      return {
        ok: true,
        output: { spawner: roster.spawner, peers: roster.peers },
        modelText: linesOf(roster).join('\n'),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
