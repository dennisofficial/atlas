import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { atlasVaultFile } from '../credentials/paths'
import { atlasSecretsFile } from '../secrets/paths'

const OWNER_ONLY = 0o600

const rawVaultSchema = z.looseObject({
  version: z.number(),
  accounts: z.array(z.looseObject({ id: z.string() })),
  active: z.record(z.string(), z.unknown()),
})

const rawSecretsSchema = z.looseObject({
  version: z.number(),
  secrets: z.record(z.string(), z.string()),
})

type RawVault = z.infer<typeof rawVaultSchema>
type RawSecrets = z.infer<typeof rawSecretsSchema>

export const archivedPathOf = (file: string): string => `${file}.archived`

const readJson = <T>(args: { file: string; schema: z.ZodType<T> }): T | undefined => {
  if (!existsSync(args.file)) return undefined
  return args.schema.parse(JSON.parse(readFileSync(args.file, 'utf8')))
}

const writeJson = (args: { file: string; value: unknown }): void => {
  mkdirSync(dirname(args.file), { recursive: true })
  const staging = join(dirname(args.file), `.${randomUUID()}.tmp`)
  writeFileSync(staging, `${JSON.stringify(args.value, null, 2)}\n`, {
    mode: OWNER_ONLY,
  })
  renameSync(staging, args.file)
}

const mergeVaults = (args: { into: RawVault; from: RawVault; ids?: ReadonlySet<string> }) => {
  const taken = (id: string): boolean => args.ids === undefined || args.ids.has(id)
  const held = new Set(args.into.accounts.map((account) => account.id))
  const moved = args.from.accounts.filter((account) => taken(account.id))
  const active = { ...args.into.active }
  for (const [provider, id] of Object.entries(args.from.active)) {
    if (typeof id === 'string' && taken(id) && active[provider] === undefined) active[provider] = id
  }
  return {
    merged: {
      ...args.into,
      accounts: [...args.into.accounts, ...moved.filter((account) => !held.has(account.id))],
      active,
    },
    remainder: {
      ...args.from,
      accounts: args.from.accounts.filter((account) => !taken(account.id)),
      active: Object.fromEntries(
        Object.entries(args.from.active).filter(([, id]) => typeof id !== 'string' || !taken(id)),
      ),
    },
  }
}

const mergeSecrets = (args: {
  into: RawSecrets
  from: RawSecrets
  names?: ReadonlySet<string>
}) => {
  const taken = (name: string): boolean => args.names === undefined || args.names.has(name)
  const moved = Object.entries(args.from.secrets).filter(([name]) => taken(name))
  return {
    merged: {
      ...args.into,
      secrets: { ...Object.fromEntries(moved), ...args.into.secrets },
    },
    remainder: {
      ...args.from,
      secrets: Object.fromEntries(
        Object.entries(args.from.secrets).filter(([name]) => !taken(name)),
      ),
    },
  }
}

export type LocalArchive = {
  archiveAccounts: (ids: readonly string[]) => void
  archiveSecrets: (names: readonly string[]) => void
}

export const fileLocalArchive = (): LocalArchive => ({
  archiveAccounts: (ids) => {
    if (ids.length === 0) return
    const file = atlasVaultFile()
    const live = readJson({ file, schema: rawVaultSchema })
    if (live === undefined) return
    const archived = readJson({
      file: archivedPathOf(file),
      schema: rawVaultSchema,
    }) ?? {
      ...live,
      accounts: [],
      active: {},
    }
    if (archived.version !== live.version) return
    const { merged, remainder } = mergeVaults({
      into: archived,
      from: live,
      ids: new Set(ids),
    })
    if (remainder.accounts.length === live.accounts.length) return
    writeJson({ file: archivedPathOf(file), value: merged })
    writeJson({ file, value: remainder })
  },
  archiveSecrets: (names) => {
    if (names.length === 0) return
    const file = atlasSecretsFile()
    const live = readJson({ file, schema: rawSecretsSchema })
    if (live === undefined) return
    const archived = readJson({
      file: archivedPathOf(file),
      schema: rawSecretsSchema,
    }) ?? {
      ...live,
      secrets: {},
    }
    const { merged, remainder } = mergeSecrets({
      into: archived,
      from: live,
      names: new Set(names),
    })
    if (Object.keys(remainder.secrets).length === Object.keys(live.secrets).length) return
    writeJson({ file: archivedPathOf(file), value: merged })
    writeJson({ file, value: remainder })
  },
})

export const restoreArchivedVault = (file: string): boolean => {
  const live = readJson({ file, schema: rawVaultSchema })
  const archived = readJson({
    file: archivedPathOf(file),
    schema: rawVaultSchema,
  })
  if (live === undefined || archived === undefined || live.version !== archived.version)
    return false
  writeJson({
    file,
    value: mergeVaults({ into: live, from: archived }).merged,
  })
  rmSync(archivedPathOf(file), { force: true })
  return true
}

export const restoreArchivedSecrets = (file: string): boolean => {
  const live = readJson({ file, schema: rawSecretsSchema })
  const archived = readJson({
    file: archivedPathOf(file),
    schema: rawSecretsSchema,
  })
  if (live === undefined || archived === undefined) return false
  writeJson({
    file,
    value: mergeSecrets({ into: live, from: archived }).merged,
  })
  rmSync(archivedPathOf(file), { force: true })
  return true
}
