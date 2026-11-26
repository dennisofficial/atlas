import { type Db, createDb, createPool } from '@dltech/atlas-db'
import type { McpTransport } from '@dltech/atlas-plugin-mcp/core'
import { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { EAccessScope, EMcpServerScope } from '@dltech/atlas-wire/web'

import type { GrantView, GrantWrite } from './cloud-config-grants'
import { groupConfigClientOf } from './cloud-config-group'
import { personalConfigClientOf } from './cloud-config-personal'
import { projectConfigClientOf } from './cloud-config-project'
import { databaseUrlWithTls } from './database-url'
import type { AgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

export type SettingRow = { key: string; value: string }

export type McpServerView = {
  name: string
  transport: McpTransport | undefined
  disabled: boolean
  proxy: boolean
}

export type McpServerWrite = {
  name: string
  transport: McpTransport | undefined
  disabled: boolean
  proxy?: boolean
}

export type SecretEntry = { name: string; grant: string }

export type FileMountView = { path: string; mode: number; grant: string }

export type SecretWrite = { name: string; value: string; grant?: string | undefined }

export type FileMountWrite = {
  path: string
  contents: string
  mode: number
  grant?: string | undefined
}

export type CloudConfigClient = {
  readonly scope: EAccessScope
  listSettings(): Promise<readonly SettingRow[]>
  readSetting(key: string): Promise<SettingRow | null>
  setSetting(args: { key: string; stored: string }): Promise<void>
  removeSetting(key: string): Promise<boolean>
  listSecrets(): Promise<readonly SecretEntry[]>
  setSecret(args: SecretWrite): Promise<void>
  moveSecret(args: { name: string; grant: string }): Promise<boolean>
  removeSecret(name: string): Promise<boolean>
  listFileMounts(): Promise<readonly FileMountView[]>
  setFileMount(args: FileMountWrite): Promise<void>
  moveFileMount(args: { path: string; grant: string }): Promise<boolean>
  removeFileMount(path: string): Promise<boolean>
  listGrants(): Promise<readonly GrantView[]>
  readGrant(name: string): Promise<GrantView | null>
  setGrant(args: GrantWrite): Promise<void>
  removeGrant(name: string): Promise<boolean>
}

export type McpConfigClient = {
  readonly projectId: string
  listMcpServers(scope?: EMcpServerScope): Promise<readonly McpServerView[]>
  readMcpServer(name: string, scope?: EMcpServerScope): Promise<McpServerView | null>
  putMcpServer(server: McpServerWrite, scope?: EMcpServerScope): Promise<void>
  removeMcpServer(name: string, scope?: EMcpServerScope): Promise<boolean>
}

export type ProjectCloudConfigClient = CloudConfigClient & McpConfigClient

export type CloudConfigStore = {
  forProject(projectId: string): ProjectCloudConfigClient
  forGroupOfProject(projectId: string): CloudConfigClient
  forPersonal(userId: string): CloudConfigClient
}

export { DEFAULT_FILE_MODE } from './cloud-config-seal'

export const cloudConfigStore = (
  env: Pick<AgentHostEnv, 'databaseUrl' | 'secretsEncryptionKey'>,
): CloudConfigStore => {
  let db: Db | undefined
  let cipher: SecretCipher | undefined
  const opened = (): { db: Db; cipher: SecretCipher } => {
    if (db === undefined || cipher === undefined) {
      db = createDb(
        createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
      )
      cipher = new SecretCipher(env.secretsEncryptionKey)
    }
    return { db, cipher }
  }
  return {
    forProject: (projectId) => projectConfigClientOf({ ...opened(), projectId }),
    forGroupOfProject: (projectId) => groupConfigClientOf({ ...opened(), projectId }),
    forPersonal: (userId) => personalConfigClientOf({ ...opened(), userId }),
  }
}
