import { z } from 'zod'

import { okResultSchema } from './result'

const serverIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .refine((id) => id.replace(/\./g, '') !== '', 'a server id cannot be only dots')

const exitSchema = z
  .object({ exitCode: z.number().int().nullable(), signal: z.string().min(1).nullable() })
  .strict()

export const mcpSpawnOpSchema = z
  .object({
    op: z.literal('mcp.spawn'),
    serverId: serverIdSchema,
    command: z.string().min(1),
    args: z.array(z.string()).readonly().optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict()

export const mcpSpawnResultSchema = z
  .object({ serverId: serverIdSchema, pid: z.number().int().min(0) })
  .strict()

export const mcpSendOpSchema = z
  .object({ op: z.literal('mcp.send'), serverId: serverIdSchema, line: z.string() })
  .strict()

export const mcpSendResultSchema = z.null()

export const mcpReadOpSchema = z
  .object({
    op: z.literal('mcp.read'),
    serverId: serverIdSchema,
    afterSeq: z.number().int().min(0),
  })
  .strict()

export const mcpLineSchema = z.object({ seq: z.number().int().min(1), line: z.string() }).strict()

export const mcpReadResultSchema = z
  .object({ lines: z.array(mcpLineSchema).readonly(), ended: exitSchema.nullable() })
  .strict()

export const mcpCloseOpSchema = z
  .object({ op: z.literal('mcp.close'), serverId: serverIdSchema })
  .strict()

export const mcpCloseResultSchema = exitSchema

export const mcpListOpSchema = z.object({ op: z.literal('mcp.list') }).strict()

export const mcpListEntrySchema = z
  .object({ serverId: serverIdSchema, pid: z.number().int().min(0), running: z.boolean() })
  .strict()

export const mcpListResultSchema = z.array(mcpListEntrySchema).readonly()

export const mcpOpSchemas = [
  mcpSpawnOpSchema,
  mcpSendOpSchema,
  mcpReadOpSchema,
  mcpCloseOpSchema,
  mcpListOpSchema,
] as const

export const mcpResultSchemas = [
  okResultSchema({ op: 'mcp.spawn', value: mcpSpawnResultSchema }),
  okResultSchema({ op: 'mcp.send', value: mcpSendResultSchema }),
  okResultSchema({ op: 'mcp.read', value: mcpReadResultSchema }),
  okResultSchema({ op: 'mcp.close', value: mcpCloseResultSchema }),
  okResultSchema({ op: 'mcp.list', value: mcpListResultSchema }),
] as const

export const mcpMessageEventSchema = z
  .object({
    type: z.literal('mcp.message'),
    serverId: serverIdSchema,
    seq: z.number().int().min(1),
    line: z.string(),
  })
  .strict()

export const mcpExitedEventSchema = z
  .object({ type: z.literal('mcp.exited'), serverId: serverIdSchema, ...exitSchema.shape })
  .strict()

export const mcpEventSchemas = [mcpMessageEventSchema, mcpExitedEventSchema] as const

export type McpSpawnOp = z.infer<typeof mcpSpawnOpSchema>
export type McpSendOp = z.infer<typeof mcpSendOpSchema>
export type McpReadOp = z.infer<typeof mcpReadOpSchema>
export type McpCloseOp = z.infer<typeof mcpCloseOpSchema>
export type McpListOp = z.infer<typeof mcpListOpSchema>
export type McpLine = z.infer<typeof mcpLineSchema>
export type McpReadResult = z.infer<typeof mcpReadResultSchema>
export type McpListEntry = z.infer<typeof mcpListEntrySchema>
export type McpMessageEvent = z.infer<typeof mcpMessageEventSchema>
export type McpExitedEvent = z.infer<typeof mcpExitedEventSchema>
