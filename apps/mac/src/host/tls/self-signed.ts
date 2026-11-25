import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'

const CURVE = 'prime256v1'
const HOST = '127.0.0.1'
const OCTETS = [127, 0, 0, 1] as const

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2'
const OID_COMMON_NAME = '2.5.4.3'
const OID_SUBJECT_ALT_NAME = '2.5.29.17'
const OID_BASIC_CONSTRAINTS = '2.5.29.19'
const OID_EXT_KEY_USAGE = '2.5.29.37'
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1'

const TAG_BOOLEAN = 0x01
const TAG_INTEGER = 0x02
const TAG_BIT_STRING = 0x03
const TAG_OCTET_STRING = 0x04
const TAG_OID = 0x06
const TAG_UTF8_STRING = 0x0c
const TAG_UTC_TIME = 0x17
const TAG_GENERALIZED_TIME = 0x18
const TAG_SEQUENCE = 0x30
const TAG_SET = 0x31
const TAG_IP_ADDRESS = 0x87
const TAG_CONTEXT_0 = 0xa0
const TAG_CONTEXT_3 = 0xa3

const DAY_MS = 86_400_000
const BACKDATE_MS = DAY_MS
const LIFETIME_MS = 397 * DAY_MS
const SERIAL_BYTES = 16
const V3 = 2

export interface ISelfSignedCert {
  certPem: string
  keyPem: string
  fingerprint: string
}

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content])
}

const sequence = (...items: Buffer[]): Buffer => tlv(TAG_SEQUENCE, Buffer.concat(items))

const set = (...items: Buffer[]): Buffer => tlv(TAG_SET, Buffer.concat(items))

const explicit = ({ tag, content }: { tag: number; content: Buffer }): Buffer => tlv(tag, content)

function oidOf(dotted: string): Buffer {
  const parts = dotted.split('.').map((part) => Number.parseInt(part, 10))
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  const bytes: number[] = [first * 40 + second]
  for (const part of parts.slice(2)) {
    const group: number[] = [part & 0x7f]
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128))
      group.unshift(0x80 | (rest & 0x7f))
    bytes.push(...group)
  }
  return tlv(TAG_OID, Buffer.from(bytes))
}

function integerOf(bytes: Buffer): Buffer {
  const first = bytes[0] ?? 0
  return tlv(TAG_INTEGER, (first & 0x80) === 0 ? bytes : Buffer.concat([Buffer.from([0]), bytes]))
}

function serialOf(): Buffer {
  const bytes = randomBytes(SERIAL_BYTES)
  const first = (bytes[0] ?? 0) & 0x7f
  bytes[0] = first === 0 ? 1 : first
  return bytes
}

function timeOf(date: Date): Buffer {
  const iso = date.toISOString()
  if (date.getUTCFullYear() >= 2050)
    return tlv(
      TAG_GENERALIZED_TIME,
      Buffer.from(
        `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`,
        'ascii',
      ),
    )
  return tlv(
    TAG_UTC_TIME,
    Buffer.from(
      `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`,
      'ascii',
    ),
  )
}

function nameOf(commonName: string): Buffer {
  return sequence(
    set(sequence(oidOf(OID_COMMON_NAME), tlv(TAG_UTF8_STRING, Buffer.from(commonName, 'utf8')))),
  )
}

function extensionOf({
  oid,
  value,
  critical = false,
}: {
  oid: string
  value: Buffer
  critical?: boolean
}): Buffer {
  const criticalFlag = critical ? [tlv(TAG_BOOLEAN, Buffer.from([0xff]))] : []
  return sequence(oidOf(oid), ...criticalFlag, tlv(TAG_OCTET_STRING, value))
}

function pemOf({ label, der }: { label: string; der: Buffer }): string {
  const base64 = der
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .replace(/\n$/, '')
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`
}

export function createSelfSignedCert({ now }: { now: number }): ISelfSignedCert {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: CURVE })
  const name = nameOf(HOST)
  const signatureAlgorithm = sequence(oidOf(OID_ECDSA_SHA256))
  const subjectAltName = sequence(tlv(TAG_IP_ADDRESS, Buffer.from(OCTETS)))
  const extensions = explicit({
    tag: TAG_CONTEXT_3,
    content: sequence(
      extensionOf({ oid: OID_BASIC_CONSTRAINTS, value: sequence(), critical: true }),
      extensionOf({ oid: OID_EXT_KEY_USAGE, value: sequence(oidOf(OID_SERVER_AUTH)) }),
      extensionOf({ oid: OID_SUBJECT_ALT_NAME, value: subjectAltName }),
    ),
  })
  const tbs = sequence(
    explicit({ tag: TAG_CONTEXT_0, content: integerOf(Buffer.from([V3])) }),
    integerOf(serialOf()),
    signatureAlgorithm,
    name,
    sequence(timeOf(new Date(now - BACKDATE_MS)), timeOf(new Date(now + LIFETIME_MS))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  )
  const signature = sign('sha256', tbs, privateKey)
  const der = sequence(
    tbs,
    signatureAlgorithm,
    tlv(TAG_BIT_STRING, Buffer.concat([Buffer.from([0]), signature])),
  )
  return {
    certPem: pemOf({ label: 'CERTIFICATE', der }),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: `sha256/${createHash('sha256').update(der).digest('base64')}`,
  }
}
