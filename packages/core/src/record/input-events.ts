import { z } from 'zod'

import { attachmentSchema } from '../attachments/attachment-schema'
import { EMessageOrigin } from '../events/body'
import { inputMessageSchema, type InputMessage, type InputMessageRowFields } from './input-message'

export const INPUT_KIND_COMMAND_PREFIX = 'command:'

export enum EInputKind {
  Message = 'message',
  Stop = 'stop',
  Retry = 'retry',
  OperatorAnswer = 'operator-answer',
}

export const commandInputKind = (name: string): string => `${INPUT_KIND_COMMAND_PREFIX}${name}`

export const isMessageInputKind = (kind: string): boolean => kind === EInputKind.Message

export const isCommandInputKind = (kind: string): boolean =>
  kind.startsWith(INPUT_KIND_COMMAND_PREFIX)

export const commandInputName = (kind: string): string | undefined =>
  isCommandInputKind(kind) ? kind.slice(INPUT_KIND_COMMAND_PREFIX.length) : undefined

export type InputPosted = {
  type: 'input-posted'
  inboxId: number
  kind: string
  postedAt: string
  message?: InputMessage | undefined
  callId?: string | undefined
  sealedValue?: string | undefined
} & InputMessageRowFields

export type InputWithdrawn = {
  type: 'input-withdrawn'
  inboxId: number
  requestInboxId?: number | undefined
}

export type InputRefused = {
  type: 'input-refused'
  inboxId: number
  reason: string
  clientId?: string | undefined
  targetInboxId?: number | undefined
  message?: InputMessage | undefined
} & InputMessageRowFields

const inboxIdSchema = z.number().int().min(1)

const legacyMessageFields = {
  text: z.string().optional(),
  attachments: z.array(attachmentSchema).optional(),
  via: z.enum(EMessageOrigin).optional(),
  sender: z.object({ session: z.string().min(1) }).optional(),
}

export const inputPostedSchema = z.object({
  type: z.literal('input-posted'),
  inboxId: inboxIdSchema,
  kind: z.string().min(1),
  postedAt: z.string().min(1),
  message: inputMessageSchema.optional(),
  clientId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  sealedValue: z.string().min(1).optional(),
  ...legacyMessageFields,
})

export const inputWithdrawnSchema = z.object({
  type: z.literal('input-withdrawn'),
  inboxId: inboxIdSchema,
  requestInboxId: inboxIdSchema.optional(),
})

export const inputRefusedSchema = z.object({
  type: z.literal('input-refused'),
  inboxId: inboxIdSchema,
  reason: z.string(),
  clientId: z.string().min(1).optional(),
  targetInboxId: inboxIdSchema.optional(),
  message: inputMessageSchema.optional(),
  ...legacyMessageFields,
})
