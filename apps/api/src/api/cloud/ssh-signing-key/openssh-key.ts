import { BadRequestException } from '@nestjs/common'

const PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----'
const PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----'
const AUTH_MAGIC = Buffer.from('openssh-key-v1\0', 'latin1')
const ED25519 = 'ssh-ed25519'
const ED25519_KEY_BYTES = 32
const ED25519_SECRET_BYTES = 64
const PADDING_BLOCK = 8

const refuse = (reason: string): BadRequestException =>
  new BadRequestException(`privateKey must be an unencrypted openssh ed25519 key: ${reason}`)

class Cursor {
  private offset = 0

  constructor(private readonly bytes: Buffer) {}

  isDrained(): boolean {
    return this.offset === this.bytes.length
  }

  rest(): Buffer {
    return this.take(this.bytes.length - this.offset)
  }

  uint32(): number {
    const raw = this.take(4)
    return raw.readUInt32BE(0)
  }

  string(): Buffer {
    return this.take(this.uint32())
  }

  private take(length: number): Buffer {
    if (this.offset + length > this.bytes.length) throw refuse('truncated key')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }
}

function decodeBody(privateKey: string): Buffer {
  const trimmed = privateKey.trim()
  if (!trimmed.startsWith(PEM_HEADER) || !trimmed.endsWith(PEM_FOOTER)) {
    throw refuse('not an openssh pem')
  }
  const base64 = trimmed
    .slice(PEM_HEADER.length, trimmed.length - PEM_FOOTER.length)
    .replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw refuse('not an openssh pem')
  return Buffer.from(base64, 'base64')
}

function requireNone(args: { value: Buffer; what: string }): void {
  if (args.value.toString('latin1') !== 'none') throw refuse(`${args.what} is not none`)
}

function requirePadding(padding: Buffer): void {
  if (padding.length >= PADDING_BLOCK) throw refuse('bad padding')
  padding.forEach((byte, index) => {
    if (byte !== index + 1) throw refuse('bad padding')
  })
}

function requirePrivateBlock(args: { block: Buffer; publicBytes: Buffer }): void {
  const cursor = new Cursor(args.block)
  if (cursor.uint32() !== cursor.uint32()) throw refuse('checkints differ')
  if (cursor.string().toString('latin1') !== ED25519) throw refuse('not an ed25519 key')
  if (!cursor.string().equals(args.publicBytes)) throw refuse('public key mismatch')
  const secret = cursor.string()
  if (secret.length !== ED25519_SECRET_BYTES) throw refuse('bad ed25519 private key')
  if (!secret.subarray(ED25519_KEY_BYTES).equals(args.publicBytes))
    throw refuse('public key mismatch')
  cursor.string()
  requirePadding(cursor.rest())
}

export function publicKeyLineOf(args: { privateKey: string }): string {
  const body = decodeBody(args.privateKey)
  if (!body.subarray(0, AUTH_MAGIC.length).equals(AUTH_MAGIC)) throw refuse('bad magic')
  const cursor = new Cursor(body.subarray(AUTH_MAGIC.length))
  requireNone({ value: cursor.string(), what: 'ciphername' })
  requireNone({ value: cursor.string(), what: 'kdfname' })
  cursor.string()
  if (cursor.uint32() !== 1) throw refuse('expected exactly one key')
  const blob = cursor.string()
  const inner = new Cursor(blob)
  if (inner.string().toString('latin1') !== ED25519) throw refuse('not an ed25519 key')
  const publicBytes = inner.string()
  if (publicBytes.length !== ED25519_KEY_BYTES) throw refuse('bad ed25519 public key')
  const block = cursor.string()
  if (!cursor.isDrained()) throw refuse('trailing data')
  requirePrivateBlock({ block, publicBytes })
  return `${ED25519} ${blob.toString('base64')}`
}
