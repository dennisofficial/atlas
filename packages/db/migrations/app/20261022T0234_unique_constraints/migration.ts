#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2508d2fce685f5a105af81d479e0cb974044a107acbca7a90bbbc3c051f8e2be/contract'
import endContract from '../../snapshots/2508d2fce685f5a105af81d479e0cb974044a107acbca7a90bbbc3c051f8e2be/contract.json' with {
  type: 'json',
}
import type { Contract as Start } from '../../snapshots/64cb0885c524619aabe36260368c3940d543a21b3ee63b53c73aea62f33a6d4b/contract'
import startContract from '../../snapshots/64cb0885c524619aabe36260368c3940d543a21b3ee63b53c73aea62f33a6d4b/contract.json' with {
  type: 'json',
}
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration'

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract
  override readonly endContractJson = endContract

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_threadId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'CloudSandbox',
        index: 'CloudSandbox_threadId_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'CloudSetting',
        index: 'CloudSetting_userId_key_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'Event',
        index: 'Event_threadId_contextSlot_contextKey_contextDigest_key',
      }),
      this.dropIndex({ schema: 'public', table: 'Event', index: 'Event_threadId_seq_key' }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubConnection',
        index: 'GithubConnection_userId_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubSubscription',
        index: 'GithubSubscription_userId_repoFullName_branch_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'LocalPodLease',
        index: 'LocalPodLease_tokenHash_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'LocalPodLease',
        index: 'LocalPodLease_userId_threadId_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'McpServerConfig',
        index: 'McpServerConfig_userId_name_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'Memory',
        index: 'Memory_userId_scope_project_name_key',
      }),
      this.dropIndex({ schema: 'public', table: 'Organization', index: 'Organization_slug_key' }),
      this.dropIndex({
        schema: 'public',
        table: 'ProjectMcpServer',
        index: 'ProjectMcpServer_projectId_name_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'ProjectSecret',
        index: 'ProjectSecret_projectId_name_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'ProjectSetting',
        index: 'ProjectSetting_projectId_key_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'PublishedBundle',
        index: 'PublishedBundle_pathname_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'PublishedBundle',
        index: 'PublishedBundle_userId_version_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'SecretEntry',
        index: 'SecretEntry_userId_name_key',
      }),
      this.dropIndex({ schema: 'public', table: 'Session', index: 'Session_token_key' }),
      this.dropIndex({
        schema: 'public',
        table: 'SshSigningKey',
        index: 'SshSigningKey_userId_key',
      }),
      this.dropIndex({ schema: 'public', table: 'User', index: 'User_email_key' }),
      this.dropIndex({
        schema: 'public',
        table: 'UserFile',
        index: 'UserFile_userId_tree_path_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'WorkspaceMcpServer',
        index: 'WorkspaceMcpServer_organizationId_name_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'WorkspaceSecret',
        index: 'WorkspaceSecret_organizationId_name_key',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'WorkspaceSetting',
        index: 'WorkspaceSetting_organizationId_key_key',
      }),
      this.addUnique({
        schema: 'public',
        table: 'CloudSandbox',
        constraint: 'CloudSandbox_threadId_key',
        columns: ['threadId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GithubSubscription',
        foreignKey: {
          name: 'GithubSubscription_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'CloudSandbox', columns: ['threadId'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addUnique({
        schema: 'public',
        table: 'CloudSetting',
        constraint: 'CloudSetting_userId_key_key',
        columns: ['userId', 'key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Event',
        constraint: 'Event_threadId_contextSlot_contextKey_contextDigest_key',
        columns: ['threadId', 'contextSlot', 'contextKey', 'contextDigest'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Event',
        constraint: 'Event_threadId_seq_key',
        columns: ['threadId', 'seq'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubConnection',
        constraint: 'GithubConnection_userId_key',
        columns: ['userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_userId_repoFullName_branch_key',
        columns: ['userId', 'repoFullName', 'branch'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'LocalPodLease',
        constraint: 'LocalPodLease_tokenHash_key',
        columns: ['tokenHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'LocalPodLease',
        constraint: 'LocalPodLease_userId_threadId_key',
        columns: ['userId', 'threadId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'McpServerConfig',
        constraint: 'McpServerConfig_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Memory',
        constraint: 'Memory_userId_scope_project_name_key',
        columns: ['userId', 'scope', 'project', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Organization',
        constraint: 'Organization_slug_key',
        columns: ['slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectMcpServer',
        constraint: 'ProjectMcpServer_projectId_name_key',
        columns: ['projectId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectSecret',
        constraint: 'ProjectSecret_projectId_name_key',
        columns: ['projectId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectSetting',
        constraint: 'ProjectSetting_projectId_key_key',
        columns: ['projectId', 'key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'PublishedBundle',
        constraint: 'PublishedBundle_pathname_key',
        columns: ['pathname'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'PublishedBundle',
        constraint: 'PublishedBundle_userId_version_key',
        columns: ['userId', 'version'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'SecretEntry',
        constraint: 'SecretEntry_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Session',
        constraint: 'Session_token_key',
        columns: ['token'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'SshSigningKey',
        constraint: 'SshSigningKey_userId_key',
        columns: ['userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'User',
        constraint: 'User_email_key',
        columns: ['email'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'UserFile',
        constraint: 'UserFile_userId_tree_path_key',
        columns: ['userId', 'tree', 'path'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'WorkspaceMcpServer',
        constraint: 'WorkspaceMcpServer_organizationId_name_key',
        columns: ['organizationId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'WorkspaceSecret',
        constraint: 'WorkspaceSecret_organizationId_name_key',
        columns: ['organizationId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'WorkspaceSetting',
        constraint: 'WorkspaceSetting_organizationId_key_key',
        columns: ['organizationId', 'key'],
      }),
    ]
  }
}

MigrationCLI.run(import.meta.url, M)
