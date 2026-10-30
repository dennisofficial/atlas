import {
  saidBody,
  type EventDraft,
  type SaidFile,
  type SaidUpload,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'
import type { MessageIntake } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export type Said = {
  text: string
  requestId?: string | undefined
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  uploads?: readonly SaidUpload[] | undefined
  context?: readonly EventDraft[] | undefined
}

export function createTurnCommit(args: {
  app: ServeApp
  threadId: () => ThreadId
  intake: MessageIntake | null
}) {
  const { app, intake } = args

  const writeDrafts = async (drafts: readonly EventDraft[]): Promise<void> => {
    const threadId = args.threadId()
    const runId = app.ids.nextRunId()
    const existing = await app.threads.find({ threadId })
    if (existing !== undefined) {
      await app.log.append({ threadId, runId, drafts })
    } else {
      await app.threads.createWithFirstEvents({
        threadId,
        drafts,
        runId,
        workspace: app.workspace.workspace,
        repo: app.workspace.repo,
      })
    }
    // The operator's own words never pass through the runner's publishing log, so nothing else
    // emits the wake a mirrored client needs to clear its "sending…" placeholder at commit time
    // rather than at turn settle. This is the same explicit publish the idle-park append uses.
    app.channel.publisherFor({ threadId }).eventsAppended()
  }

  return async (said: Said): Promise<void> => {
    const threadId = args.threadId()
    if (intake !== null) {
      intake.submit({
        threadId,
        text: said.text,
        ...(said.requestId === undefined ? {} : { requestId: said.requestId }),
        ...(said.images === undefined ? {} : { images: said.images }),
        ...(said.files === undefined ? {} : { files: said.files }),
        ...(said.uploads === undefined ? {} : { uploads: said.uploads }),
        ...(said.context === undefined ? {} : { context: said.context }),
      })
      await intake.commit({ threadId, append: writeDrafts })
      return
    }
    const held = said.context ?? []
    const expanded = app.expandContext?.({ text: said.text, context: held }) ?? []
    await writeDrafts([
      ...held,
      ...expanded,
      saidBody({
        text: said.text,
        requestId: said.requestId,
        images: said.images,
        files: said.files,
        uploads: said.uploads,
      }),
    ])
  }
}
