import { EAgentStart, EAgentStatus, EExecutionLocation, EMessageOrigin, EWorktreeExit, TEAMMATE_AGENT_TYPE, toThreadId, type EventLogPort, type IdPort, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../src/store/thread-store'
import type { LiveCheckoutSpec } from './workspace-roundtrip-live-family'

export const LIVE_MODEL = { ref: 'openrouter/openai/gpt-4o-mini', effort: 'medium' }

export type LiveTeammate = { spec: LiveCheckoutSpec; threadId: ThreadId; exitsKeep: boolean }

export async function seedTeammates(args: {
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
  rootId: ThreadId
  repository: string
  home: string
  specs: readonly LiveCheckoutSpec[]
  exitedKey: string
}): Promise<LiveTeammate[]> {
  const { threads, log, ids } = args
  const teammates: LiveTeammate[] = []
  for (const spec of args.specs) {
    const threadId = toThreadId(`brn_live_${spec.key.replace(/-/g, '_')}_${crypto.randomUUID()}`)
    const exitsKeep = spec.key === args.exitedKey
    const intent = `Own ${spec.key}`
    await threads.createWithFirstEvents({
      threadId, runId: ids.nextRunId(), workspace: args.home, repo: args.repository,
      executionLocation: EExecutionLocation.Host, model: LIVE_MODEL, title: intent,
      agent: { spawnedBy: args.rootId, type: TEAMMATE_AGENT_TYPE },
      drafts: [{ type: 'user-said', text: `${intent}.`, via: EMessageOrigin.ParentAgent }],
    })
    await log.append({
      threadId, runId: ids.nextRunId(),
      drafts: [
        { type: 'worktree-entered', path: spec.path, branch: spec.branch, base: 'main', adopted: false },
        ...(exitsKeep ? [{ type: 'worktree-exited' as const, path: spec.path, action: EWorktreeExit.Keep, returnTo: args.home }] : []),
        { type: 'assistant-said', parts: [{ type: 'text', text: `${spec.key} finished its work.` }] },
      ],
    })
    await log.append({
      threadId: args.rootId, runId: ids.nextRunId(),
      drafts: [
        { type: 'agent-spawned', agentId: threadId, agentType: TEAMMATE_AGENT_TYPE, intent, mode: EAgentStart.Fresh },
        { type: 'agent-ended', agentId: threadId, agentType: TEAMMATE_AGENT_TYPE, intent, status: EAgentStatus.Finished, prose: `${spec.key} finished its work.`, turns: 1, toolCalls: 0 },
      ],
    })
    teammates.push({ spec, threadId, exitsKeep })
  }
  return teammates
}
