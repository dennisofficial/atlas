import { z } from 'zod'

import { okResultSchema } from './result'

const terminalIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .refine((id) => !/^\.+$/.test(id))

const dimensionSchema = z.number().int().min(1).max(1000)

export const terminalExitSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
  })
  .strict()

export const terminalOpenOpSchema = z
  .object({
    op: z.literal('terminal.open'),
    terminalId: terminalIdSchema,
    cols: dimensionSchema,
    rows: dimensionSchema,
    cwd: z.string().min(1).optional(),
  })
  .strict()

export const terminalWriteOpSchema = z
  .object({
    op: z.literal('terminal.write'),
    terminalId: terminalIdSchema,
    data: z.string(),
  })
  .strict()

export const terminalResizeOpSchema = z
  .object({
    op: z.literal('terminal.resize'),
    terminalId: terminalIdSchema,
    cols: dimensionSchema,
    rows: dimensionSchema,
  })
  .strict()

export const terminalCloseOpSchema = z
  .object({
    op: z.literal('terminal.close'),
    terminalId: terminalIdSchema,
  })
  .strict()

export const terminalReadOpSchema = z
  .object({
    op: z.literal('terminal.read'),
    terminalId: terminalIdSchema,
    offset: z.number().int().min(0),
  })
  .strict()

export const terminalOpenResultSchema = z
  .object({ terminalId: terminalIdSchema, pid: z.number().int().min(1) })
  .strict()

export const terminalReadResultSchema = z
  .object({
    offset: z.number().int().min(0),
    data: z.base64(),
    totalBytes: z.number().int().min(0),
    exited: terminalExitSchema.nullable(),
  })
  .strict()

export const terminalOpSchemas = [
  terminalOpenOpSchema,
  terminalWriteOpSchema,
  terminalResizeOpSchema,
  terminalCloseOpSchema,
  terminalReadOpSchema,
] as const

export const terminalResultSchemas = [
  okResultSchema({ op: 'terminal.open', value: terminalOpenResultSchema }),
  okResultSchema({ op: 'terminal.write', value: z.null() }),
  okResultSchema({ op: 'terminal.resize', value: z.null() }),
  okResultSchema({ op: 'terminal.close', value: terminalExitSchema }),
  okResultSchema({ op: 'terminal.read', value: terminalReadResultSchema }),
] as const

export const terminalOutputEventSchema = z
  .object({
    type: z.literal('terminal.output'),
    terminalId: terminalIdSchema,
    offset: z.number().int().min(0),
    data: z.base64(),
  })
  .strict()

export const terminalExitEventSchema = z
  .object({
    type: z.literal('terminal.exit'),
    terminalId: terminalIdSchema,
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
  })
  .strict()

export const terminalEventSchemas = [terminalOutputEventSchema, terminalExitEventSchema] as const

export type TerminalOpenOp = z.infer<typeof terminalOpenOpSchema>
export type TerminalWriteOp = z.infer<typeof terminalWriteOpSchema>
export type TerminalResizeOp = z.infer<typeof terminalResizeOpSchema>
export type TerminalCloseOp = z.infer<typeof terminalCloseOpSchema>
export type TerminalReadOp = z.infer<typeof terminalReadOpSchema>
export type TerminalExit = z.infer<typeof terminalExitSchema>
export type TerminalOpenResult = z.infer<typeof terminalOpenResultSchema>
export type TerminalReadResult = z.infer<typeof terminalReadResultSchema>
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>
export type TerminalExitEvent = z.infer<typeof terminalExitEventSchema>
