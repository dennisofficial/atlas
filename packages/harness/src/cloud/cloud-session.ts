import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { SecretCipher } from '../credentials/secret-cipher'

const OWNER_ONLY = 0o600
const SESSION_VERSION = 1

export type CloudSession = { url: string; token: string; email: string | null }

const cloudSessionFileSchema = z.object({
  version: z.literal(SESSION_VERSION),
  url: z.string().min(1),
  email: z.string().nullable(),
  sealedToken: z.string().min(1),
})

export class CloudSessionStore {
  private readonly cipher: SecretCipher

  constructor(private readonly args: { file: string; keyFile: string }) {
    this.cipher = new SecretCipher(args.keyFile)
  }

  read(): CloudSession | null {
    let text: string
    try {
      text = readFileSync(this.args.file, 'utf8')
    } catch {
      return null
    }

    try {
      const parsed = cloudSessionFileSchema.parse(JSON.parse(text))
      return {
        url: parsed.url,
        email: parsed.email,
        token: this.cipher.decrypt(parsed.sealedToken),
      }
    } catch {
      return null
    }
  }

  write(args: CloudSession): void {
    mkdirSync(dirname(this.args.file), { recursive: true })

    const written = JSON.stringify({
      version: SESSION_VERSION,
      url: args.url,
      email: args.email,
      sealedToken: this.cipher.encrypt(args.token),
    })
    const temporary = join(dirname(this.args.file), `.${randomUUID()}.tmp`)
    writeFileSync(temporary, `${written}\n`, { mode: OWNER_ONLY })
    renameSync(temporary, this.args.file)
  }

  clear(): void {
    rmSync(this.args.file, { force: true })
  }
}
