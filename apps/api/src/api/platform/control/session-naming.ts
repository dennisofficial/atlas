import type { Logger } from '@nestjs/common'
import { fallbackTitleOf, type ControlPlane } from '@dltech/atlas-control'
import type { MediaStore } from '@dltech/atlas-media'
import type { SessionTitler } from '../../../_core/ports/session-titler'
import type { Attachment } from '@dltech/atlas-core'
import { imagesForNaming } from './media-attachments'

export async function nameSession(args: {
  store: MediaStore
  titler: SessionTitler
  plane: ControlPlane
  logger: Logger
  userId: string
  sessionId: string
  projectId: string
  text: string
  attachments: readonly Attachment[]
  inboxId: number
  modelRef: string | null
}): Promise<void> {
  try {
    const images = await imagesForNaming({
      store: args.store,
      userId: args.userId,
      attachments: args.attachments,
    })
    const generated = await args.titler
      .nameOf({
        userId: args.userId,
        projectId: args.projectId,
        text: args.text,
        ...(images.length === 0 ? {} : { images }),
        ...(args.modelRef === null ? {} : { modelRef: args.modelRef }),
        onFault: (fault) => args.logger.warn(`naming ${args.sessionId} failed: ${String(fault)}`),
      })
      .catch((failure: unknown) => {
        args.logger.warn(`naming ${args.sessionId} failed: ${String(failure)}`)
        return null
      })
    const title = generated ?? fallbackTitleOf(args.text)
    if (title === null) return
    await args.plane.titleUntitledSession({
      sessionId: args.sessionId,
      title,
      fromInboxId: args.inboxId,
    })
  } catch (failure) {
    args.logger.warn(`storing the name of ${args.sessionId} failed: ${String(failure)}`)
  }
}
