import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const OWNER_ONLY = 0o600

export interface ISecretCipher {
  encrypt: (plaintext: string) => string
  decrypt: (sealed: string) => string
}

export function createSecretCipher({ keyFile }: { keyFile: string }): ISecretCipher {
  let held: Buffer | undefined

  const unreadable = (detail: string): Error =>
    new Error(`A stored secret could not be decrypted with ${keyFile}: ${detail}. Sign in again.`)

  const loadKey = (): Buffer => {
    if (held !== undefined) return held
    mkdirSync(dirname(keyFile), { recursive: true })
    const key = Buffer.from(readOrCreateKeyText(), 'hex')
    if (key.length !== KEY_BYTES)
      throw unreadable(`${keyFile} must hold ${KEY_BYTES * 2} hex characters`)
    chmodSync(keyFile, OWNER_ONLY)
    held = key
    return key
  }

  const readOrCreateKeyText = (): string => {
    try {
      return readFileSync(keyFile, 'utf8').trim()
    } catch {
      const created = randomBytes(KEY_BYTES).toString('hex')
      writeFileSync(keyFile, `${created}\n`, { mode: OWNER_ONLY })
      return created
    }
  }

  return {
    encrypt: (plaintext) => {
      const nonce = randomBytes(NONCE_BYTES)
      const cipher = createCipheriv(ALGORITHM, loadKey(), nonce)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return [nonce, cipher.getAuthTag(), ciphertext]
        .map((part) => part.toString('base64'))
        .join('.')
    },
    decrypt: (sealed) => {
      const [nonceText, tagText, ciphertextText, ...rest] = sealed.split('.')
      if (nonceText === undefined || tagText === undefined || ciphertextText === undefined)
        throw unreadable('the value is not a sealed blob')
      if (rest.length > 0) throw unreadable('the value is not a sealed blob')
      const nonce = Buffer.from(nonceText, 'base64')
      const tag = Buffer.from(tagText, 'base64')
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES)
        throw unreadable('the value is not a sealed blob')
      try {
        const decipher = createDecipheriv(ALGORITHM, loadKey(), nonce)
        decipher.setAuthTag(tag)
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextText, 'base64')),
          decipher.final(),
        ]).toString('utf8')
      } catch {
        throw unreadable('the value does not match this key')
      }
    },
  }
}
