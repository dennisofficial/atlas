import { generateKeyPairSync, randomBytes } from 'node:crypto'

const KEY_TYPE = 'ssh-ed25519'
const AUTH_MAGIC = Buffer.from('openssh-key-v1\0', 'latin1')
const PEM_COLUMNS = 70
const PADDING_BLOCK = 8
const PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----'
const PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----'

const uint32 = (value: number): Buffer => {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(value >>> 0)
  return out
}

const sshString = (value: Buffer | string): Buffer => {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return Buffer.concat([uint32(bytes.length), bytes])
}

const paddingFor = (length: number): Buffer => {
  const missing = (PADDING_BLOCK - (length % PADDING_BLOCK)) % PADDING_BLOCK
  return Buffer.from(Array.from({ length: missing }, (_, index) => index + 1))
}

const wrap = (text: string): string =>
  text.match(new RegExp(`.{1,${PEM_COLUMNS}}`, 'g'))?.join('\n') ?? ''

const ed25519Material = (): { seed: Buffer; pub: Buffer } => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const jwk = privateKey.export({ format: 'jwk' })
  if (jwk.d === undefined || jwk.x === undefined)
    throw new Error('ed25519 key export lacked its components')
  return { seed: Buffer.from(jwk.d, 'base64url'), pub: Buffer.from(jwk.x, 'base64url') }
}

export const generateSigningKeyPair = (args: {
  comment: string
}): { privateKey: string; publicKey: string } => {
  const { seed, pub } = ed25519Material()
  const publicBlob = Buffer.concat([sshString(KEY_TYPE), sshString(pub)])
  const checkint = uint32(randomBytes(4).readUInt32BE())

  const privateUnpadded = Buffer.concat([
    checkint,
    checkint,
    sshString(KEY_TYPE),
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString(args.comment),
  ])
  const privateBlock = Buffer.concat([privateUnpadded, paddingFor(privateUnpadded.length)])

  // https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
  const container = Buffer.concat([
    AUTH_MAGIC,
    sshString('none'),
    sshString('none'),
    sshString(''),
    uint32(1),
    sshString(publicBlob),
    sshString(privateBlock),
  ])

  const base64Blob = publicBlob.toString('base64')
  return {
    privateKey: `${PEM_HEADER}\n${wrap(container.toString('base64'))}\n${PEM_FOOTER}\n`,
    publicKey:
      args.comment.length === 0
        ? `${KEY_TYPE} ${base64Blob}`
        : `${KEY_TYPE} ${base64Blob} ${args.comment}`,
  }
}
