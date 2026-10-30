import { mcpTransportSchema } from '@dltech/atlas-wire'
import { z } from 'zod'

export enum ECloudConfigScope {
  Project = 'project',
  Personal = 'personal',
}

export enum ECloudConfigKind {
  Setting = 'setting',
  Secret = 'secret',
  Mcp = 'mcp',
  File = 'file',
}

export enum ECloudConfigAction {
  List = 'list',
  Read = 'read',
  Set = 'set',
  Remove = 'remove',
}

export const cloudConfigInputSchema = z.strictObject({
  scope: z.enum(ECloudConfigScope),
  kind: z.enum(ECloudConfigKind),
  action: z.enum(ECloudConfigAction),
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  value: z.string().optional(),
  contents: z.string().optional(),
  mode: z
    .string()
    .regex(/^0?[0-7]{3}$/, 'mode must be an octal string like 0600 or 644')
    .optional(),
  transport: mcpTransportSchema.optional(),
  projectId: z.string().min(1).optional(),
})

export type CloudConfigInput = z.output<typeof cloudConfigInputSchema>
