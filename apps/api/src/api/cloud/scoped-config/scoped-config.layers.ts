import type { ScopedMcpServer, ScopedSecret, ScopeLayer } from '@dltech/atlas-wire/web'
import { mcpUpsertSchema } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openMcpServer } from '../mcp-servers/mcp-sealed'
import { kindOf, openSecretValue } from '../secrets/sealed-secret'

type SealedSecretRow = { name: string; kind: string; sealedValue: string }
type SealedMcpRow = { sealedSpec: string; updatedAt: Date }
type SettingRow = { key: string; value: string }

const settingsOf = (rows: readonly SettingRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.key, row.value]))

const secretsOf = (args: { cipher: SecretCipherService; rows: readonly SealedSecretRow[] }): ScopedSecret[] =>
  args.rows.map((row) => ({
    name: row.name,
    kind: kindOf(row.kind),
    value: openSecretValue({ cipher: args.cipher, sealed: row.sealedValue }),
  }))

const mcpServersOf = (args: { cipher: SecretCipherService; rows: readonly SealedMcpRow[] }): ScopedMcpServer[] =>
  args.rows.flatMap((row) => {
    const opened = openMcpServer({ cipher: args.cipher, sealedSpec: row.sealedSpec, updatedAt: row.updatedAt })
    const spec = mcpUpsertSchema.safeParse({ transport: opened.transport, disabled: opened.disabled })
    return spec.success ? [{ name: opened.name, spec: spec.data }] : []
  })

const layerOf = (args: {
  cipher: SecretCipherService
  settings: readonly SettingRow[]
  secrets: readonly SealedSecretRow[]
  mcpServers: readonly SealedMcpRow[]
}): ScopeLayer => ({
  settings: settingsOf(args.settings),
  secrets: secretsOf({ cipher: args.cipher, rows: args.secrets }),
  mcpServers: mcpServersOf({ cipher: args.cipher, rows: args.mcpServers }),
})

export const loadUserLayer = async (args: { cipher: SecretCipherService; userId: string }): Promise<ScopeLayer> => {
  const where = { userId: args.userId }
  const [settings, secrets, mcpServers] = await Promise.all([
    db.orm.public.UserSetting.where(where).all(),
    db.orm.public.UserSecret.where(where).all(),
    db.orm.public.UserMcpServer.where(where).all(),
  ])
  return layerOf({ cipher: args.cipher, settings, secrets, mcpServers })
}

export const loadWorkspaceLayer = async (args: {
  cipher: SecretCipherService
  organizationId: string
}): Promise<ScopeLayer> => {
  const where = { organizationId: args.organizationId }
  const [settings, secrets, mcpServers] = await Promise.all([
    db.orm.public.WorkspaceSetting.where(where).all(),
    db.orm.public.WorkspaceSecret.where(where).all(),
    db.orm.public.WorkspaceMcpServer.where(where).all(),
  ])
  return layerOf({ cipher: args.cipher, settings, secrets, mcpServers })
}

export const loadProjectLayer = async (args: { cipher: SecretCipherService; projectId: string }): Promise<ScopeLayer> => {
  const where = { projectId: args.projectId }
  const [settings, secrets, mcpServers] = await Promise.all([
    db.orm.public.ProjectSetting.where(where).all(),
    db.orm.public.ProjectSecret.where(where).all(),
    db.orm.public.ProjectMcpServer.where(where).all(),
  ])
  return layerOf({ cipher: args.cipher, settings, secrets, mcpServers })
}
