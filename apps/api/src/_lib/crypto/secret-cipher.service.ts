import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { EnvService } from '@core/config/env/env.service'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

@Injectable()
export class SecretCipherService {
  private readonly key: Buffer

  constructor(env: EnvService) {
    const raw = env.get('SECRETS_ENCRYPTION_KEY')
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64')
    if (key.length !== 32) {
      throw new Error(
        `SECRETS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}) — use 64 hex chars or 32-byte base64`,
      )
    }
    this.key = key
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv, tag, ciphertext].map((part) => part.toString('base64')).join('.')
  }

  decrypt(blob: string): string {
    const parts = blob.split('.')
    if (parts.length !== 3) {
      throw new Error('malformed encrypted secret blob (expected iv.tag.ciphertext)')
    }
    const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string]
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ciphertext = Buffer.from(ciphertextB64, 'base64')
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new Error('malformed encrypted secret blob (bad iv/tag length)')
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}
