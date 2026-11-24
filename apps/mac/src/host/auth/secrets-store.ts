import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createSecretCipher } from './secret-cipher'
import { emptySecrets, secretsFileSchema, type SecretsFile } from './secrets-file'

const OWNER_ONLY = 0o600

export interface ISecretsStore {
  read: (name: string) => string | undefined
  write: (written: { name: string; value: string }) => void
  remove: (name: string) => void
}

export function createSecretsStore({
  file,
  keyFile,
}: {
  file: string
  keyFile: string
}): ISecretsStore {
  const cipher = createSecretCipher({ keyFile })

  const load = (): SecretsFile => {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return emptySecrets()
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`${file} is not valid JSON`)
    }
    const parsed = secretsFileSchema.safeParse(json)
    if (!parsed.success) throw new Error(`${file} does not hold secrets`)
    return parsed.data
  }

  const save = (held: SecretsFile): void => {
    mkdirSync(dirname(file), { recursive: true })
    const staging = join(dirname(file), `.${randomUUID()}.tmp`)
    writeFileSync(staging, `${JSON.stringify(held, null, 2)}\n`, { mode: OWNER_ONLY })
    renameSync(staging, file)
  }

  return {
    read: (name) => {
      const sealed = load().secrets[name]
      return sealed === undefined ? undefined : cipher.decrypt(sealed)
    },
    write: ({ name, value }) => {
      const held = load()
      const sealed = cipher.encrypt(value)
      save({ ...held, secrets: { ...held.secrets, [name]: sealed } })
    },
    remove: (name) => {
      const held = load()
      const secrets = { ...held.secrets }
      delete secrets[name]
      save({ ...held, secrets })
    },
  }
}
