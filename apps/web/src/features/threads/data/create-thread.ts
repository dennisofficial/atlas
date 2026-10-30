import type { SaidUpload } from '@dltech/atlas-core'
import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { uploadsFieldOf } from './composer-attachments'
import { imagesFieldOf } from './composer-images'

export type CreateThreadBody = {
  projectId?: string
  model?: string
  effort?: string
  firstMessage: {
    sendId: string
    text: string
    images?: SaidImageWire[]
    uploads?: SaidUpload[]
  }
}

export function createThreadBodyOf(args: {
  projectId: string | null
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  uploads?: SaidUpload[] | undefined
  model?: string | undefined
  effort?: string | undefined
}): CreateThreadBody {
  return {
    ...(args.projectId === null ? {} : { projectId: args.projectId }),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    firstMessage: {
      sendId: args.sendId,
      text: args.text,
      ...imagesFieldOf(args.images),
      ...uploadsFieldOf(args.uploads),
    },
  }
}
