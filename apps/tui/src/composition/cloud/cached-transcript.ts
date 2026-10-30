import type { ThreadId } from '@dltech/atlas-core'
import { EExecutionLocation } from '@dltech/atlas-core'
import { eventsFromWire, transcriptIdentityDigest } from '@dltech/atlas-harness'

import type { ToolEffects } from '../../store/log-accumulator'
import type { AtlasApp } from '../compose'
import type { OpenedConversation } from '../open-conversation'
import { snapshotOf } from '../thread-reads'

export async function readCachedCloudTranscript(args: {
  app: Pick<AtlasApp, 'cloud' | 'threads'>
  threadId: ThreadId
  effects: ToolEffects
}): Promise<OpenedConversation | null> {
  const session = args.app.cloud.session()
  if (session === null) return null

  try {
    const wire = await args.app.cloud
      .sessionsClient({ session })
      .readEvents({ threadId: args.threadId })
    const events = eventsFromWire(wire)
    if (events.length === 0) return null

    const snapshot = snapshotOf({
      events,
      effects: args.effects,
      digest: transcriptIdentityDigest,
    })
    const thread = await args.app.threads.find({ threadId: args.threadId })
    return {
      threadId: args.threadId,
      events: snapshot.events,
      turns: [],
      name: thread?.title ?? null,
      started: true,
      model: thread?.model,
      executionLocation: EExecutionLocation.Cloud,
      base: snapshot.base,
      bootCloudThreadId: args.threadId,
    }
  } catch {
    return null
  }
}
