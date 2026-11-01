import {
  EMessageOrigin,
  saidBody,
  type EventLogPort,
  type IdPort,
  type SaidFile,
  type SaidImage,
  type SaidUpload,
  type ThreadId,
} from '@dltech/atlas-core'
import type { TurnRunner } from '@dltech/atlas-harness'

import type { ServeAgentSteer } from './serve-app'

export type ChildSendFrame = {
  text: string
  requestId?: string | undefined
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  uploads?: readonly SaidUpload[] | undefined
}

/**
 * A Send addressed at a family thread that is not the served root is delivered through the child
 * registry: a stepping child takes it as a steer (its own intake resolves uploads), a settled one
 * gets the event appended here — uploads included — and is run for a turn. Appending directly,
 * rather than through the intake of a settled child, is what keeps an upload reference on the
 * event: the intake path carries text, images and files only.
 */
export async function sayToChild(args: {
  agents: ServeAgentSteer
  runner: Pick<TurnRunner, 'runTurn'>
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
  owner: ThreadId
  agentId: ThreadId
  frame: ChildSendFrame
}): Promise<void> {
  const { agents, runner, log, ids, owner, agentId, frame } = args
  const steered = await agents.say({
    threadId: owner,
    agentId,
    text: frame.text,
    ...(frame.images === undefined ? {} : { images: frame.images }),
    ...(frame.files === undefined ? {} : { files: frame.files }),
  })
  if (steered.ok) return

  await log.append({
    threadId: agentId,
    runId: ids.nextRunId(),
    drafts: [
      {
        ...saidBody({
          text: frame.text,
          ...(frame.requestId === undefined ? {} : { requestId: frame.requestId }),
          images: frame.images,
          files: frame.files,
          uploads: frame.uploads,
        }),
        via: EMessageOrigin.Operator,
      },
    ],
  })
  await runner.runTurn({ threadId: agentId })
}
