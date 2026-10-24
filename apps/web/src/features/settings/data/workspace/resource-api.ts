import {
  workspaceSecretSchema,
  type ESecretKind,
  type McpServerWire,
  type McpUpsertWire,
} from '@dltech/atlas-wire/web'
import type { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'

const listedSecretSchema = workspaceSecretSchema.partial({ updatedBy: true })
export type ListedSecret = z.infer<typeof listedSecretSchema>

export enum EResourceOwner {
  Project = 'project',
  Workspace = 'workspace',
}

export type ResourceOwner =
  | { kind: EResourceOwner.Project; projectId: string }
  | { kind: EResourceOwner.Workspace; organizationId: string }

export const workspaceOwner = (organizationId: string): ResourceOwner => ({
  kind: EResourceOwner.Workspace,
  organizationId,
})

export const projectOwner = (projectId: string): ResourceOwner => ({
  kind: EResourceOwner.Project,
  projectId,
})

export const ownerKeyOf = (owner: ResourceOwner): string =>
  owner.kind === EResourceOwner.Project
    ? `project:${owner.projectId}`
    : `workspace:${owner.organizationId}`

export async function listSecrets(owner: ResourceOwner): Promise<ListedSecret[]> {
  const body = await cloudCall(
    owner.kind === EResourceOwner.Project
      ? api.projectResources.listSecrets.query({ projectId: owner.projectId })
      : api.workspaces.listSecrets.query({ organizationId: owner.organizationId }),
  )
  return body.secrets
}

export const putSecret = (args: {
  owner: ResourceOwner
  name: string
  value: string
  kind: ESecretKind
}): Promise<void> => {
  const secret = { name: args.name, value: args.value, kind: args.kind }
  return cloudCall(
    args.owner.kind === EResourceOwner.Project
      ? api.projectResources.setSecret.mutate({ projectId: args.owner.projectId, ...secret })
      : api.workspaces.setSecret.mutate({ organizationId: args.owner.organizationId, ...secret }),
  )
}

export const deleteSecret = (args: { owner: ResourceOwner; name: string }): Promise<void> =>
  cloudCall(
    args.owner.kind === EResourceOwner.Project
      ? api.projectResources.removeSecret.mutate({
          projectId: args.owner.projectId,
          name: args.name,
        })
      : api.workspaces.removeSecret.mutate({
          organizationId: args.owner.organizationId,
          name: args.name,
        }),
  )

export async function listMcpServers(owner: ResourceOwner): Promise<McpServerWire[]> {
  const body = await cloudCall(
    owner.kind === EResourceOwner.Project
      ? api.projectResources.listMcpServers.query({ projectId: owner.projectId })
      : api.workspaces.listMcpServers.query({ organizationId: owner.organizationId }),
  )
  return body.servers
}

export const putMcpServer = (args: {
  owner: ResourceOwner
  name: string
  spec: McpUpsertWire
}): Promise<void> =>
  cloudCall(
    args.owner.kind === EResourceOwner.Project
      ? api.projectResources.putMcpServer.mutate({
          projectId: args.owner.projectId,
          name: args.name,
          ...args.spec,
        })
      : api.workspaces.putMcpServer.mutate({
          organizationId: args.owner.organizationId,
          name: args.name,
          ...args.spec,
        }),
  )

export const deleteMcpServer = (args: { owner: ResourceOwner; name: string }): Promise<void> =>
  cloudCall(
    args.owner.kind === EResourceOwner.Project
      ? api.projectResources.removeMcpServer.mutate({
          projectId: args.owner.projectId,
          name: args.name,
        })
      : api.workspaces.removeMcpServer.mutate({
          organizationId: args.owner.organizationId,
          name: args.name,
        }),
  )
