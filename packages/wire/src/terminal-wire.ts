import { z } from 'zod'

export const MAX_TERMINAL_DIMENSION = 500

const dimensionSchema = z.number().int().min(1).max(MAX_TERMINAL_DIMENSION)

const terminalIdWireSchema = z.string().min(1)

export const terminalOpenParamsSchema = z.object({ cols: dimensionSchema, rows: dimensionSchema })
export type TerminalOpenParams = z.infer<typeof terminalOpenParamsSchema>

export const terminalOpenReplySchema = z.object({ terminalId: terminalIdWireSchema })
export type TerminalOpenReply = z.infer<typeof terminalOpenReplySchema>

export const terminalWriteParamsSchema = z.object({
  terminalId: terminalIdWireSchema,
  data: z.string(),
})
export type TerminalWriteParams = z.infer<typeof terminalWriteParamsSchema>

export const terminalResizeParamsSchema = z.object({
  terminalId: terminalIdWireSchema,
  cols: dimensionSchema,
  rows: dimensionSchema,
})
export type TerminalResizeParams = z.infer<typeof terminalResizeParamsSchema>

export const terminalCloseParamsSchema = z.object({ terminalId: terminalIdWireSchema })
export type TerminalCloseParams = z.infer<typeof terminalCloseParamsSchema>

export const terminalAckReplySchema = z.object({ done: z.boolean() })
export type TerminalAckReply = z.infer<typeof terminalAckReplySchema>

export const terminalOutputWireSchema = z.object({
  terminalId: terminalIdWireSchema,
  data: z.string(),
})
export type TerminalOutputWire = z.infer<typeof terminalOutputWireSchema>

export const terminalExitWireSchema = z.object({
  terminalId: terminalIdWireSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
})
export type TerminalExitWire = z.infer<typeof terminalExitWireSchema>
