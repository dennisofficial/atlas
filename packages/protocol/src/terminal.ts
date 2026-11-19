import { z } from 'zod'

import {
  dimensionSchema,
  terminalIdSchema,
  terminalOpenResultSchema,
  terminalReadResultSchema,
} from './ops/terminal'

export { dimensionSchema, terminalIdSchema }

export const MAX_TERMINALS = 8

export const terminalRowSchema = z.strictObject({
  terminalId: z.string().min(1),
  ordinal: z.number().int().min(1),
  name: z.string().min(1),
  state: z.enum(['opening', 'open', 'ended']),
  exitCode: z.number().int().nullable(),
  signal: z.string().min(1).nullable(),
  endedReason: z.enum(['exited', 'closed', 'pod-slept', 'lost', 'failed']).nullable(),
  createdAt: z.number().int().min(0),
  endedAt: z.number().int().min(0).nullable(),
})
export type TerminalRow = z.infer<typeof terminalRowSchema>

const sessionIdSchema = z.string().min(1)

export const terminalListInputSchema = z.strictObject({ sessionId: sessionIdSchema })
export type TerminalListInput = z.infer<typeof terminalListInputSchema>
export const terminalListOutputSchema = z.strictObject({ terminals: z.array(terminalRowSchema) })
export type TerminalListOutput = z.infer<typeof terminalListOutputSchema>

export const terminalOpenInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  cols: dimensionSchema,
  rows: dimensionSchema,
  cwd: z.string().min(1).optional(),
})
export type TerminalOpenInput = z.infer<typeof terminalOpenInputSchema>
export const terminalOpenOutputSchema = z.discriminatedUnion('state', [
  terminalOpenResultSchema.extend({ state: z.literal('open') }),
  z.strictObject({ state: z.literal('parked') }),
])
export type TerminalOpenOutput = z.infer<typeof terminalOpenOutputSchema>

export const terminalMutationOutputSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('done') }),
  z.strictObject({ state: z.literal('parked') }),
])
export type TerminalMutationOutput = z.infer<typeof terminalMutationOutputSchema>

export const terminalRefInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  terminalId: terminalIdSchema,
})

export const terminalRenameInputSchema = terminalRefInputSchema.extend({
  name: z.string().trim().min(1).max(60),
})
export type TerminalRenameInput = z.infer<typeof terminalRenameInputSchema>

export const terminalWriteInputSchema = terminalRefInputSchema.extend({ data: z.string() })
export type TerminalWriteInput = z.infer<typeof terminalWriteInputSchema>

export const terminalResizeInputSchema = terminalRefInputSchema.extend({
  cols: dimensionSchema,
  rows: dimensionSchema,
})
export type TerminalResizeInput = z.infer<typeof terminalResizeInputSchema>

export const terminalCloseInputSchema = terminalRefInputSchema
export type TerminalCloseInput = z.infer<typeof terminalCloseInputSchema>

export const terminalReadInputSchema = terminalRefInputSchema.extend({
  offset: z.number().int().min(0),
})
export type TerminalReadInput = z.infer<typeof terminalReadInputSchema>
export const terminalReadOutputSchema = terminalReadResultSchema
export type TerminalReadOutput = z.infer<typeof terminalReadOutputSchema>

const terminalIdField = z.string().min(1)

export const terminalStreamFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), sessionId: sessionIdSchema }),
  z.strictObject({ type: z.literal('parked') }),
  z.strictObject({
    type: z.literal('output'),
    terminalId: terminalIdField,
    offset: z.number().int().min(0),
    data: z.base64(),
  }),
  z.strictObject({
    type: z.literal('exit'),
    terminalId: terminalIdField,
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
  }),
  z.strictObject({
    type: z.literal('closed'),
    reason: z.enum(['asleep', 'restarted', 'detached']),
  }),
  z.strictObject({
    type: z.literal('gap'),
    terminalId: terminalIdField,
    offset: z.number().int().min(0),
  }),
])
export type TerminalStreamFrame = z.infer<typeof terminalStreamFrameSchema>

export const terminalStreamAttachInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  cursors: z.array(
    z.strictObject({
      terminalId: z.string().min(1),
      offset: z.number().int().min(0),
    }),
  ),
})
export type TerminalStreamAttachInput = z.infer<typeof terminalStreamAttachInputSchema>

export const TERMINAL_STREAM_BUFFER_BYTES = 262_144
