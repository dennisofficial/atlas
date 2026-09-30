import {
  agentLabel,
  EAgentStart,
  EMessageOrigin,
  type EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import type { AgentType } from '../types'

export async function openChildThread({
  threads,
  log,
  ids,
  spawnedBy,
  agentType,
  brief,
  intent,
  model,
}: {
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
  spawnedBy: ThreadId
  agentType: AgentType
  brief: string
  intent: string
  model?: ThreadModel | undefined
}): Promise<{ threadId: ThreadId; inheritedLocation: EExecutionLocation | undefined }> {
  const spawner = await threads.find({ threadId: spawnedBy })
  const { thread } = await threads.createWithFirstEvents({
    runId: ids.nextRunId(),
    model,
    drafts: [{ type: 'user-said', text: brief, via: EMessageOrigin.ParentAgent }],
    title: agentLabel({ agentType: agentType.name, intent }),
    agent: { spawnedBy, type: agentType.name },
    ...(spawner?.workspace == null ? {} : { workspace: spawner.workspace }),
    ...(spawner === undefined ? {} : { repo: spawner.repo }),
    ...(spawner?.executionLocation === undefined
      ? {}
      : { executionLocation: spawner.executionLocation }),
  })

  await log.append({
    threadId: spawnedBy,
    runId: ids.nextRunId(),
    drafts: [
      {
        type: 'agent-spawned',
        agentId: thread.id,
        agentType: agentType.name,
        intent,
        mode: EAgentStart.Fresh,
      },
    ],
  })

  return { threadId: thread.id, inheritedLocation: spawner?.executionLocation }
}
