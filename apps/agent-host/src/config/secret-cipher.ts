import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

const keyOf = (raw: string): Buffer => {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`)
  }
  return key
}

export class SecretCipher {
  private readonly key: Buffer

  constructor(raw: string) {
    this.key = keyOf(raw)
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.')
  }

  decrypt(blob: string): string {
    const parts = blob.split('.')
    if (parts.length !== 3) {
      throw new Error('malformed encrypted secret blob (expected iv.tag.ciphertext)')
    }
    const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64')) as [
      Buffer,
      Buffer,
      Buffer,
    ]
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new Error('malformed encrypted secret blob (bad iv/tag length)')
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  }
}
