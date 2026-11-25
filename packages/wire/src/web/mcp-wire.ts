import { z } from 'zod'

import { configLayerOwnerSchema, configLayerSchema } from '../project-group-wire'

export enum EMcpTransportKind {
  Stdio = 'stdio',
  Http = 'http',
}

export enum EMcpServerScope {
  Personal = 'personal',
  Group = 'group',
  Project = 'project',
}

export const mcpTransportSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(EMcpTransportKind.Stdio),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({
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
  proxy: z.boolean().optional(),
  updatedAt: z.string(),
})
export type McpServerWire = z.infer<typeof mcpServerSchema>

export const mcpUpsertSchema = z.strictObject({
  transport: mcpTransportSchema.optional(),
  disabled: z.boolean().optional(),
  proxy: z.boolean().optional(),
})
export type McpUpsertWire = z.infer<typeof mcpUpsertSchema>

export const mcpServerScopeShape = {
  scope: z.enum(EMcpServerScope).optional(),
  projectId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
}

export const mcpServerScopeSchema = z.strictObject(mcpServerScopeShape)
export type McpServerScope = z.infer<typeof mcpServerScopeSchema>

export const scopedMcpServerPutSchema = mcpUpsertSchema.extend({
  name: z.string().min(1),
  ...mcpServerScopeShape,
})
export type ScopedMcpServerPut = z.infer<typeof scopedMcpServerPutSchema>

export const scopedMcpServerKeySchema = z.strictObject({
  name: z.string().min(1),
  ...mcpServerScopeShape,
})
export type ScopedMcpServerKey = z.infer<typeof scopedMcpServerKeySchema>

export const mcpServerLayerItemSchema = mcpServerSchema.extend({
  overriddenBy: configLayerSchema.nullable(),
})
export type McpServerLayerItem = z.infer<typeof mcpServerLayerItemSchema>

export const mcpServerLayerSchema = z.object({
  layer: configLayerSchema,
  owner: configLayerOwnerSchema,
  items: z.array(mcpServerLayerItemSchema),
})
export type McpServerLayer = z.infer<typeof mcpServerLayerSchema>

export const mcpServerLayersSchema = z.object({ layers: z.array(mcpServerLayerSchema) })
export type McpServerLayers = z.infer<typeof mcpServerLayersSchema>
