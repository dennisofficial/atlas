import { saidBody, type EventDraft } from '@dltech/atlas-core'

import type { PendingSaid } from './pending-queue'

export const userSaidDraft = (said: PendingSaid): EventDraft =>
  saidBody({
    text: said.text,
    requestId: said.requestId,
    images: said.images,
    files: said.files,
    uploads: said.uploads,
  })
