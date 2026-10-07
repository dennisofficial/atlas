import { saidBody, type EventDraft, type SaidFile, type SaidImage, type ThreadId } from '@dltech/atlas-core'
import type { MessageIntake } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export type Said = {
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  context?: readonly EventDraft[] | undefined
}

export function createTurnCommit(args: { app: ServeApp; threadId: ThreadId; intake: MessageIntake | null }) {
  const { app, threadId, intake } = args

  const writeDrafts = async (drafts: readonly EventDraft[]): Promise<void> => {
    const runId = app.ids.nextRunId()
    const existing = await app.threads.find({ threadId })
    if (existing !== undefined) {
      await app.log.append({ threadId, runId, drafts })
      return
    }
    await app.threads.createWithFirstEvents({
      threadId, drafts, runId, workspace: app.workspace.workspace, repo: app.workspace.repo,
    })
  }

  return async (said: Said): Promise<void> => {
    if (intake !== null) {
      intake.submit({
        threadId, text: said.text,
        ...(said.images === undefined ? {} : { images: said.images }),
        ...(said.files === undefined ? {} : { files: said.files }),
        ...(said.context === undefined ? {} : { context: said.context }),
      })
      await intake.commit({ threadId, append: writeDrafts })
      return
    }
    await writeDrafts([
      ...(said.context ?? []),
      saidBody({ text: said.text, images: said.images, files: said.files }),
    ])
  }
}
