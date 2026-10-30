import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { SecretCipher } from '../credentials/secret-cipher'

const OWNER_ONLY = 0o600
const SNAPSHOT_VERSION = 1

const envelopeSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  url: z.string(),
  sealed: z.string().min(1),
})

export class SealedSnapshotFile {
  private readonly file: string
  private readonly cipher: SecretCipher
  private lastWritten: string | undefined

  constructor(args: { file: string; keyFile: string }) {
    this.file = args.file
    this.cipher = new SecretCipher(args.keyFile)
  }

  read(args: { url: string }): unknown {
    try {
      const envelope = envelopeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      if (envelope.url !== args.url) return undefined
      return JSON.parse(this.cipher.decrypt(envelope.sealed))
    } catch {
      return undefined
    }
  }

  write(args: { url: string; value: unknown }): void {
    const plain = JSON.stringify(args.value)
    const fingerprint = `${args.url}\n${plain}`
    if (fingerprint === this.lastWritten) return

    mkdirSync(dirname(this.file), { recursive: true })
    const envelope = {
      version: SNAPSHOT_VERSION,
      url: args.url,
      sealed: this.cipher.encrypt(plain),
    }
    const staging = join(dirname(this.file), `.${randomUUID()}.tmp`)
    writeFileSync(staging, `${JSON.stringify(envelope)}\n`, {
      mode: OWNER_ONLY,
    })
    renameSync(staging, this.file)
    this.lastWritten = fingerprint
  }

  remove(): void {
    rmSync(this.file, { force: true })
    this.lastWritten = undefined
  }
}
