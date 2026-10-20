import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { publicKeyLineOf } from './openssh-key'
import { generateKey } from './ssh-key.fixtures'

const PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----'
const PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----'
const PREAMBLE_BYTES = 39
const PUBLIC_OFFSET_IN_PRIVATE_BLOCK = 8 + 4 + 'ssh-ed25519'.length + 4

interface DecodedKey {
  preamble: Buffer
  blob: Buffer
  block: Buffer
}

function decode(privateKey: string): DecodedKey {
  const base64 = privateKey.replace(PEM_HEADER, '').replace(PEM_FOOTER, '').replace(/\s+/g, '')
  const bytes = Buffer.from(base64, 'base64')
  const blobLength = bytes.readUInt32BE(PREAMBLE_BYTES)
  const blobEnd = PREAMBLE_BYTES + 4 + blobLength
  const blockLength = bytes.readUInt32BE(blobEnd)
  return {
    preamble: bytes.subarray(0, PREAMBLE_BYTES),
    blob: bytes.subarray(PREAMBLE_BYTES + 4, blobEnd),
    block: bytes.subarray(blobEnd + 4, blobEnd + 4 + blockLength),
  }
}

const withLength = (bytes: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function encode(args: { key: DecodedKey; block?: Buffer; omitBlock?: boolean; trailing?: Buffer }): string {
  const bytes = Buffer.concat([
    args.key.preamble,
    withLength(args.key.blob),
    args.omitBlock === true ? Buffer.alloc(0) : withLength(args.block ?? args.key.block),
    args.trailing ?? Buffer.alloc(0),
  ])
  return `${PEM_HEADER}\n${bytes.toString('base64')}\n${PEM_FOOTER}\n`
}

function mutated(args: { key: DecodedKey; edit: (block: Buffer) => Buffer | void }): string {
  const block = Buffer.from(args.key.block)
  return encode({ key: args.key, block: args.edit(block) ?? block })
}

describe('publicKeyLineOf', () => {
  it('round-trips an ssh-keygen ed25519 key to its public line', () => {
    const key = generateKey({ type: 'ed25519' })

    expect(publicKeyLineOf({ privateKey: key.privateKey })).toBe(key.publicLine)
  })

  it('tolerates surrounding whitespace', () => {
    const key = generateKey({ type: 'ed25519' })

    expect(publicKeyLineOf({ privateKey: `\n${key.privateKey}\n\n` })).toBe(key.publicLine)
  })

  it('refuses an rsa key', () => {
    const key = generateKey({ type: 'rsa' })

    expect(() => publicKeyLineOf({ privateKey: key.privateKey })).toThrow(BadRequestException)
  })

  it('refuses an encrypted ed25519 key', () => {
    const key = generateKey({ type: 'ed25519', passphrase: 'hunter2' })

    expect(() => publicKeyLineOf({ privateKey: key.privateKey })).toThrow(BadRequestException)
  })

  it.each(['', 'garbage', '-----BEGIN OPENSSH PRIVATE KEY-----\n!!!\n-----END OPENSSH PRIVATE KEY-----'])(
    'refuses garbage %j',
    (privateKey) => {
      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    },
  )

  it('refuses a truncated key', () => {
    const key = generateKey({ type: 'ed25519' })
    const lines = key.privateKey.trim().split('\n')
    const truncated = [lines[0], lines[1]?.slice(0, 40), lines[lines.length - 1]].join('\n')

    expect(() => publicKeyLineOf({ privateKey: truncated })).toThrow(BadRequestException)
  })

  describe('private block validation', () => {
    const fresh = () => {
      const generated = generateKey({ type: 'ed25519' })
      return { generated, key: decode(generated.privateKey) }
    }

    it('round-trips a re-encoded ssh-keygen key unchanged', () => {
      const { generated, key } = fresh()

      expect(publicKeyLineOf({ privateKey: encode({ key }) })).toBe(generated.publicLine)
    })

    it('refuses a key with no private block', () => {
      const { key } = fresh()

      expect(() => publicKeyLineOf({ privateKey: encode({ key, omitBlock: true }) })).toThrow(BadRequestException)
    })

    it('refuses a garbage private block', () => {
      const { key } = fresh()

      expect(() => publicKeyLineOf({ privateKey: encode({ key, block: Buffer.alloc(40, 0x61) }) })).toThrow(
        BadRequestException,
      )
    })

    it('refuses mismatched checkints', () => {
      const { key } = fresh()
      const privateKey = mutated({ key, edit: (block) => void block.writeUInt32BE((block.readUInt32BE(4) ^ 1) >>> 0, 4) })

      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    })

    it('refuses a private block whose public key differs from the outer one', () => {
      const { key } = fresh()
      const privateKey = mutated({ key, edit: (block) => void block.writeUInt8(block[PUBLIC_OFFSET_IN_PRIVATE_BLOCK]! ^ 1, PUBLIC_OFFSET_IN_PRIVATE_BLOCK) })

      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    })

    it('refuses a private half whose embedded public key differs', () => {
      const { key } = fresh()
      const lastSecretByte = PUBLIC_OFFSET_IN_PRIVATE_BLOCK + 32 + 4 + 63
      const privateKey = mutated({ key, edit: (block) => void block.writeUInt8(block[lastSecretByte]! ^ 1, lastSecretByte) })

      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    })

    it('refuses bad padding', () => {
      const { key } = fresh()
      const privateKey = mutated({ key, edit: (block) => void block.writeUInt8(0x7f, block.length - 1) })

      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    })

    it('refuses a padding run of a full block or more', () => {
      const { key } = fresh()
      const padded = Buffer.concat([key.block, Buffer.from([6, 7, 8])])
      const privateKey = encode({ key, block: padded })

      expect(() => publicKeyLineOf({ privateKey })).toThrow(BadRequestException)
    })

    it('refuses trailing bytes after the private block', () => {
      const { key } = fresh()

      expect(() => publicKeyLineOf({ privateKey: encode({ key, trailing: Buffer.from([0]) }) })).toThrow(
        BadRequestException,
      )
    })
  })
})
