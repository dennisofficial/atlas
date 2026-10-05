export type EventIdentity = { id: string; seq: number; type: string }

const SHA256_CHUNK_BYTES = 64
const SHA256_LENGTH_BYTES = 8
const SHA256_CHUNK_WORDS = 16
const SHA256_WORDS = 64

// FIPS 180-4 section 4.2.2 round constants and section 5.3.3 initial hash value.
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

const rotateRight = (word: number, bits: number): number => (word >>> bits) | (word << (32 - bits))

const padMessage = (bytes: Uint8Array): Uint8Array => {
  const paddedLength =
    Math.ceil((bytes.length + 1 + SHA256_LENGTH_BYTES) / SHA256_CHUNK_BYTES) * SHA256_CHUNK_BYTES
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const bitLength = bytes.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  return padded
}

const compressChunk = ({
  state,
  message,
  chunkStart,
  schedule,
}: {
  state: Uint32Array
  message: DataView
  chunkStart: number
  schedule: Uint32Array
}): void => {
  for (let index = 0; index < SHA256_CHUNK_WORDS; index++) {
    schedule[index] = message.getUint32(chunkStart + index * 4)
  }
  for (let index = SHA256_CHUNK_WORDS; index < SHA256_WORDS; index++) {
    const earlier = schedule[index - 15] ?? 0
    const later = schedule[index - 2] ?? 0
    const smallSigma0 = rotateRight(earlier, 7) ^ rotateRight(earlier, 18) ^ (earlier >>> 3)
    const smallSigma1 = rotateRight(later, 17) ^ rotateRight(later, 19) ^ (later >>> 10)
    schedule[index] = ((schedule[index - 16] ?? 0) + smallSigma0 + (schedule[index - 7] ?? 0) + smallSigma1) >>> 0
  }

  let a = state[0] ?? 0
  let b = state[1] ?? 0
  let c = state[2] ?? 0
  let d = state[3] ?? 0
  let e = state[4] ?? 0
  let f = state[5] ?? 0
  let g = state[6] ?? 0
  let h = state[7] ?? 0

  for (let round = 0; round < SHA256_WORDS; round++) {
    const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
    const choice = (e & f) ^ (~e & g)
    const temp1 = (h + bigSigma1 + choice + (SHA256_ROUND_CONSTANTS[round] ?? 0) + (schedule[round] ?? 0)) >>> 0
    const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
    const majority = (a & b) ^ (a & c) ^ (b & c)
    const temp2 = (bigSigma0 + majority) >>> 0
    h = g
    g = f
    f = e
    e = (d + temp1) >>> 0
    d = c
    c = b
    b = a
    a = (temp1 + temp2) >>> 0
  }

  state[0] = ((state[0] ?? 0) + a) >>> 0
  state[1] = ((state[1] ?? 0) + b) >>> 0
  state[2] = ((state[2] ?? 0) + c) >>> 0
  state[3] = ((state[3] ?? 0) + d) >>> 0
  state[4] = ((state[4] ?? 0) + e) >>> 0
  state[5] = ((state[5] ?? 0) + f) >>> 0
  state[6] = ((state[6] ?? 0) + g) >>> 0
  state[7] = ((state[7] ?? 0) + h) >>> 0
}

export function sha256Hex(bytes: Uint8Array): string {
  const padded = padMessage(bytes)
  const message = new DataView(padded.buffer)
  const state = new Uint32Array(SHA256_INITIAL_STATE)
  const schedule = new Uint32Array(SHA256_WORDS)
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += SHA256_CHUNK_BYTES) {
    compressChunk({ state, message, chunkStart, schedule })
  }
  let hex = ''
  for (const word of state) hex += word.toString(16).padStart(8, '0')
  return hex
}

const identityOf = (event: EventIdentity): [string, number, string] => [event.id, event.seq, event.type]

const bySeq = (a: [string, number, string], b: [string, number, string]): number => a[1] - b[1]

const identitiesOf = (events: readonly EventIdentity[]): [string, number, string][] =>
  events.map(identityOf).sort(bySeq)

export function transcriptIdentityDigest(events: readonly EventIdentity[]): string {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(identitiesOf(events))))
}
