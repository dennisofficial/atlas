import type {
  ESecretKind,
  McpServerWire,
  McpUpsertWire,
  SecretDetail,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type ListedSecret = SecretDetail

export async function listSecrets(projectId: string): Promise<ListedSecret[]> {
  const body = await cloudCall(api.projectResources.listSecrets.query({ projectId }))
  return body.secrets
}

export const putSecret = (args: {
  projectId: string
  name: string
  value: string
  kind: ESecretKind
}): Promise<void> => cloudCall(api.projectResources.setSecret.mutate(args))

export const deleteSecret = (args: { projectId: string; name: string }): Promise<void> =>
  cloudCall(api.projectResources.removeSecret.mutate(args))

export async function listMcpServers(projectId: string): Promise<McpServerWire[]> {
  const body = await cloudCall(api.projectResources.listMcpServers.query({ projectId }))
  return body.servers
}

export const putMcpServer = (args: {
  projectId: string
  name: string
  spec: McpUpsertWire
}): Promise<void> =>
  cloudCall(
    api.projectResources.putMcpServer.mutate({
      projectId: args.projectId,
      name: args.name,
      ...args.spec,
    }),
  )

export const deleteMcpServer = (args: { projectId: string; name: string }): Promise<void> =>
  cloudCall(api.projectResources.removeMcpServer.mutate(args))
