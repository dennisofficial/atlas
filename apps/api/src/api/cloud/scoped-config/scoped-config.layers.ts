import type {
  ScopedFileMount,
  ScopedMcpServer,
  ScopedSecret,
  ScopeLayer,
} from '@dltech/atlas-wire/web'
import {
  ATLAS_HOME_MOUNT_PREFIX,
  DEFAULT_FILE_MOUNT_MODE,
  mcpUpsertSchema,
} from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openMcpServer } from '../mcp-servers/mcp-sealed'
import { openSecretValue } from '../secrets/sealed-secret'

type SealedSecretRow = { name: string; sealedValue: string }
type SealedMcpRow = { sealedSpec: string; updatedAt: Date }
type SealedFileMountRow = { path: string; sealedContents: string; mode: number }
type SettingRow = { key: string; value: string }
type SkillRow = { id: string; name: string }
type SkillFileRow = { skillId: string; path: string; content: Uint8Array; isText: boolean }

const skillMountsOf = (args: {
  skills: readonly SkillRow[]
  files: readonly SkillFileRow[]
  prefix: string
}): ScopedFileMount[] => {
  const names = new Map(args.skills.map((skill) => [skill.id, skill.name]))
  return args.files.flatMap((file) => {
    const name = names.get(file.skillId)
    if (name === undefined) return []
    return [
      {
        path: `${args.prefix}${name}/${file.path}`,
        contents: Buffer.from(file.content).toString(file.isText ? 'utf8' : 'base64'),
        mode: DEFAULT_FILE_MOUNT_MODE,
        encoding: file.isText ? 'utf8' : ('base64' as const),
      },
    ]
  })
}

const skillFilesOf = async (skills: readonly SkillRow[]): Promise<readonly SkillFileRow[]> => {
  if (skills.length === 0) return []
  return db.orm.public.SkillFile.where((file) =>
    file.skillId.in(skills.map((skill) => skill.id)),
  ).all()
}

const settingsOf = (rows: readonly SettingRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.key, row.value]))

const secretsOf = (args: {
  cipher: SecretCipherService
  rows: readonly SealedSecretRow[]
}): ScopedSecret[] =>
  args.rows.map((row) => ({
    name: row.name,
    value: openSecretValue({ cipher: args.cipher, sealed: row.sealedValue }),
  }))

const mcpServersOf = (args: {
  cipher: SecretCipherService
  rows: readonly SealedMcpRow[]
}): ScopedMcpServer[] =>
  args.rows.flatMap((row) => {
    const opened = openMcpServer({
      cipher: args.cipher,
      sealedSpec: row.sealedSpec,
      updatedAt: row.updatedAt,
    })
    const spec = mcpUpsertSchema.safeParse({
      transport: opened.transport,
      disabled: opened.disabled,
    })
    return spec.success ? [{ name: opened.name, spec: spec.data }] : []
  })

const fileMountsOf = (args: {
  cipher: SecretCipherService
  rows: readonly SealedFileMountRow[]
}): ScopedFileMount[] =>
  args.rows.map((row) => ({
    path: row.path,
    contents: openSecretValue({ cipher: args.cipher, sealed: row.sealedContents }),
    mode: row.mode,
  }))

const layerOf = (args: {
  cipher: SecretCipherService
  settings: readonly SettingRow[]
  secrets: readonly SealedSecretRow[]
  harnessSecrets: readonly SealedSecretRow[]
  mcpServers: readonly SealedMcpRow[]
  sealedFileMounts: readonly SealedFileMountRow[]
  extraFileMounts: readonly ScopedFileMount[]
}): ScopeLayer => ({
  settings: settingsOf(args.settings),
  secrets: secretsOf({ cipher: args.cipher, rows: args.secrets }),
  harnessSecrets: secretsOf({ cipher: args.cipher, rows: args.harnessSecrets }),
  mcpServers: mcpServersOf({ cipher: args.cipher, rows: args.mcpServers }),
  fileMounts: [
    ...fileMountsOf({ cipher: args.cipher, rows: args.sealedFileMounts }),
    ...args.extraFileMounts,
  ],
})

export const loadUserLayer = async (args: {
  cipher: SecretCipherService
  userId: string
}): Promise<ScopeLayer> => {
  const where = { userId: args.userId }
  const [settings, secrets, harnessSecrets, mcpServers, skills] = await Promise.all([
    db.orm.public.UserSetting.where(where).all(),
    db.orm.public.UserSecret.where(where).all(),
    db.orm.public.UserHarnessSecret.where(where).all(),
    db.orm.public.UserMcpServer.where(where).all(),
    db.orm.public.Skill.where(where).all(),
  ])
  const skillFiles = await skillFilesOf(skills)
  return layerOf({
    cipher: args.cipher,
    settings,
    secrets,
    harnessSecrets,
    mcpServers,
    sealedFileMounts: [],
    extraFileMounts: skillMountsOf({
      skills,
      files: skillFiles,
      prefix: `${ATLAS_HOME_MOUNT_PREFIX}skills/`,
    }),
  })
}

export const loadProjectLayer = async (args: {
  cipher: SecretCipherService
  projectId: string
}): Promise<ScopeLayer> => {
  const where = { projectId: args.projectId }
  const [settings, secrets, mcpServers, fileMounts, skills] = await Promise.all([
    db.orm.public.ProjectSetting.where(where).all(),
    db.orm.public.ProjectSecret.where(where).all(),
    db.orm.public.ProjectMcpServer.where(where).all(),
    db.orm.public.ProjectFileMount.where(where)
      .orderBy((row) => row.path.asc())
      .all(),
    db.orm.public.Skill.where(where).all(),
  ])
  const skillFiles = await skillFilesOf(skills)
  return layerOf({
    cipher: args.cipher,
    settings,
    secrets,
    harnessSecrets: [],
    mcpServers,
    sealedFileMounts: fileMounts,
    extraFileMounts: skillMountsOf({
      skills,
      files: skillFiles,
      prefix: `${ATLAS_HOME_MOUNT_PREFIX}project-skills/`,
    }),
  })
}
