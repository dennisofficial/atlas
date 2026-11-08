import { attachmentsOf, type SaidAttachments } from '../attachments/from-said'
import type { Attachment } from '../attachments/attachment'

export type SaidBody = {
  type: 'user-said'
  text: string
  requestId?: string | undefined
  attachments?: readonly Attachment[] | undefined
}

/**
 * Every producer of a user-said body folds whatever shape it holds into `attachments` and omits an
 * empty list rather than stamping `[]`, so the log only ever gains the one attachment field.
 */
export function saidBody(
  args: SaidAttachments & {
    text: string
    requestId?: string | undefined
  },
): SaidBody {
  const attachments = attachmentsOf(args)

  return {
    type: 'user-said',
    text: args.text,
    ...(args.requestId === undefined ? {} : { requestId: args.requestId }),
    ...(attachments.length === 0 ? {} : { attachments }),
  }
}
