import { z } from 'zod'

import type { Attachment } from '../attachments/attachment'
import { attachmentSchema } from '../attachments/attachment-schema'
import { EMessageOrigin, type EventBody } from '../events/body'

export type InputMessage = {
  text: string
  attachments?: readonly Attachment[] | undefined
  clientId?: string | undefined
  via?: EMessageOrigin | undefined
  sender?: { session: string } | undefined
}

export const inputMessageSchema = z.object({
  text: z.string(),
  attachments: z.array(attachmentSchema).optional(),
  clientId: z.string().min(1).optional(),
  via: z.enum(EMessageOrigin).optional(),
  sender: z.object({ session: z.string().min(1) }).optional(),
})

export type InputMessageRowFields = {
  text?: string | undefined
  attachments?: readonly Attachment[] | undefined
  clientId?: string | undefined
  via?: EMessageOrigin | undefined
  sender?: { session: string } | undefined
}

type InputMessageRow = {
  message?: InputMessage | undefined
} & InputMessageRowFields

export const inputMessageOfRow = (row: InputMessageRow): InputMessage | undefined => {
  if (row.message !== undefined) return row.message
  if (row.text === undefined) return undefined
  return {
    text: row.text,
    ...(row.attachments === undefined ? {} : { attachments: row.attachments }),
    ...(row.clientId === undefined || row.clientId.length === 0 ? {} : { clientId: row.clientId }),
    ...(row.via === undefined ? {} : { via: row.via }),
    ...(row.sender === undefined ? {} : { sender: row.sender }),
  }
}

export const userSaidOf = (params: {
  inboxId: number
  message: InputMessage
  requestId?: string | undefined
}): Extract<EventBody, { type: 'user-said' }> => ({
  type: 'user-said',
  ...params.message,
  requestId: params.requestId ?? `inbox:${params.inboxId}`,
  inboxId: params.inboxId,
})
