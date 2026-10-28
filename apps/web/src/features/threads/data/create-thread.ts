import type { SaidImageWire } from '@dltech/atlas-wire/web'

import { imagesFieldOf } from './composer-images'
import { threadTitleOf } from './transcript'

export type CreateThreadBody = {
  projectId?: string
  title: string
  model?: string
  effort?: string
  firstMessage: { sendId: string; text: string; images?: SaidImageWire[] }
}

export function createThreadBodyOf(args: {
  projectId: string | null
  text: string
  sendId: string
  images?: SaidImageWire[] | undefined
  model?: string | undefined
  effort?: string | undefined
}): CreateThreadBody {
  return {
    ...(args.projectId === null ? {} : { projectId: args.projectId }),
    title: threadTitleOf(args.text),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    firstMessage: { sendId: args.sendId, text: args.text, ...imagesFieldOf(args.images) },
  }
}
