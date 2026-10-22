import { describe, expect, test } from 'bun:test'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

interface Transmission {
  fields: Record<string, string>
  bytes: Buffer
}

const transmissionsOf = (output: string): Transmission[] => {
  const transmissions: Transmission[] = []
  let fields: Record<string, string> | null = null
  let payload = ''
  for (const match of output.matchAll(/\x1b_G(.*?)\x1b\\/gs)) {
    const command = match[1] ?? ''
    const separator = command.indexOf(';')
    const header = separator < 0 ? command : command.slice(0, separator)
    const chunk = separator < 0 ? '' : command.slice(separator + 1)
    const current: Record<string, string> = {}
    for (const item of header.split(',')) {
      const [key, value] = item.split('=')
      if (key !== undefined && value !== undefined) current[key] = value
    }
    if (current.a === 't') {
      fields = current
      payload = ''
    }
    if (fields === null || chunk === '') continue
    payload += chunk
    if (current.m === '1') continue
    transmissions.push({ fields, bytes: Buffer.from(payload, 'base64') })
    fields = null
    payload = ''
  }
  return transmissions
}

const probe = (opacity: number): Transmission[] => {
  const run = Bun.spawnSync({
    cmd: [
      process.execPath,
      fileURLToPath(new URL('./image-wire-probe.ts', import.meta.url)),
      String(opacity),
    ],
    env: { ...process.env, NODE_ENV: 'development' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(run.exitCode).toBe(0)
  if (run.exitCode !== 0) throw new Error(Buffer.from(run.stderr).toString())
  return transmissionsOf(Buffer.from(run.stdout).toString())
}

describe('the actual native Kitty wire', () => {
  test('keeps opaque viewport pixels in PNG without idle retransmissions', () => {
    const transmissions = probe(1)
    expect(transmissions.length).toBe(2)
    expect(transmissions.map(({ fields }) => fields.f)).toEqual(['100', '100'])
    expect(
      transmissions.map(({ bytes }) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]),
    ).toEqual([
      [64, 128],
      [64, 64],
    ])
  })

  test('compresses dimmed pixels and applies opacity exactly once', () => {
    const transmissions = probe(0.4)
    expect(transmissions.length).toBe(2)
    for (const { fields, bytes } of transmissions) {
      expect(fields.f).toBe('32')
      expect(fields.o).toBe('z')
      const pixels = inflateSync(bytes)
      expect(pixels.length).toBe(Number(fields.s) * Number(fields.v) * 4)
      expect(Array.from(pixels.subarray(0, 4))).toEqual([255, 255, 255, 102])
    }
  })
})
