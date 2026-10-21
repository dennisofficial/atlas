import {
  mcpServerSchema,
  workspaceSecretSchema,
  type ESecretKind,
  type McpServerWire,
  type McpUpsertWire,
} from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

const listedSecretSchema = workspaceSecretSchema.partial({ updatedBy: true })
export type ListedSecret = z.infer<typeof listedSecretSchema>

const secretListSchema = z.object({ secrets: z.array(listedSecretSchema) })
const mcpListSchema = z.object({ servers: z.array(mcpServerSchema) })

const secretPath = ({ base, name }: { base: string; name: string }) =>
  `${base}/secrets/${encodeURIComponent(name)}`
const mcpPath = ({ base, name }: { base: string; name: string }) =>
  `${base}/mcp-servers/${encodeURIComponent(name)}`

export const workspaceBase = (organizationId: string) =>
  `/v1/workspaces/${encodeURIComponent(organizationId)}`

export const projectBase = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}`

export async function listSecrets(base: string): Promise<ListedSecret[]> {
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: `${base}/secrets`,
    schema: secretListSchema,
  })
  return body.secrets
}

export const putSecret = (args: { base: string; name: string; value: string; kind: ESecretKind }) =>
  cloudSend({
    method: EHttpMethod.Put,
    path: secretPath(args),
    body: { value: args.value, kind: args.kind },
  })

export const deleteSecret = (args: { base: string; name: string }) =>
  cloudSend({ method: EHttpMethod.Delete, path: secretPath(args) })

export async function listMcpServers(base: string): Promise<McpServerWire[]> {
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: `${base}/mcp-servers`,
    schema: mcpListSchema,
  })
  return body.servers
}

export const putMcpServer = (args: { base: string; name: string; spec: McpUpsertWire }) =>
  cloudSend({ method: EHttpMethod.Put, path: mcpPath(args), body: args.spec })

export const deleteMcpServer = (args: { base: string; name: string }) =>
  cloudSend({ method: EHttpMethod.Delete, path: mcpPath(args) })
