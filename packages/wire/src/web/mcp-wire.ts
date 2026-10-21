import { z } from 'zod'

export enum EMcpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

export const mcpTransportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(EMcpTransportKind.Stdio),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    kind: z.literal(EMcpTransportKind.Http),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])
export type McpTransportWire = z.infer<typeof mcpTransportSchema>

export const mcpServerSchema = z.object({
  name: z.string(),
  transport: mcpTransportSchema.optional(),
  disabled: z.boolean().optional(),
  updatedAt: z.string(),
})
export type McpServerWire = z.infer<typeof mcpServerSchema>

export const mcpUpsertSchema = z.object({
  transport: mcpTransportSchema.optional(),
  disabled: z.boolean().optional(),
})
export type McpUpsertWire = z.infer<typeof mcpUpsertSchema>
