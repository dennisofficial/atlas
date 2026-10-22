import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateSigningKeyPair } from '../openssh-keygen'

const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const EMAIL = 'octo@users.noreply.github.com'

const run = (args: {
  argv: string[]
  stdin?: string
}): { code: number; stdout: string; stderr: string } => {
  const result = Bun.spawnSync([SSH_KEYGEN, ...args.argv], {
    ...(args.stdin === undefined ? {} : { stdin: Buffer.from(args.stdin) }),
  })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('generateSigningKeyPair', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-keygen-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const writeKey = (args: { name: string; privateKey: string }): string => {
    const path = join(dir, args.name)
    writeFileSync(path, args.privateKey, { mode: 0o600 })
    chmodSync(path, 0o600)
    return path
  }

  it('emits a wrapped openssh PEM with a trailing newline and a commented public line', () => {
    const pair = generateSigningKeyPair({ comment: 'atlas@octo' })
    const lines = pair.privateKey.split('\n')

    expect(lines[0]).toBe('-----BEGIN OPENSSH PRIVATE KEY-----')
    expect(lines.at(-2)).toBe('-----END OPENSSH PRIVATE KEY-----')
    expect(lines.at(-1)).toBe('')
    expect(lines.slice(1, -2).every((line) => line.length <= 70)).toBe(true)
    expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=* atlas@octo$/)
  })

  it('generates a distinct key each time', () => {
    const first = generateSigningKeyPair({ comment: 'a' })
    const second = generateSigningKeyPair({ comment: 'a' })

    expect(first.publicKey).not.toBe(second.publicKey)
    expect(first.privateKey).not.toBe(second.privateKey)
  })

  it('is read by ssh-keygen -y, which reproduces the public line', () => {
    const pair = generateSigningKeyPair({ comment: 'atlas@octo' })
    const path = writeKey({ name: 'derive', privateKey: pair.privateKey })

    const derived = run({ argv: ['-y', '-f', path] })

    expect(derived.code).toBe(0)
    expect(derived.stdout.trim()).toBe(pair.publicKey)
  })

  it('reports an empty comment as a bare public line', () => {
    const pair = generateSigningKeyPair({ comment: '' })
    const path = writeKey({ name: 'bare', privateKey: pair.privateKey })

    const derived = run({ argv: ['-y', '-f', path] })

    expect(derived.code).toBe(0)
    expect(derived.stdout.trim()).toBe(pair.publicKey)
    expect(pair.publicKey.split(' ')).toHaveLength(2)
  })

  it('signs a payload with ssh-keygen -Y sign and verifies against an allowed-signers file', () => {
    const pair = generateSigningKeyPair({ comment: 'atlas@octo' })
    const keyPath = writeKey({ name: 'signer', privateKey: pair.privateKey })
    const payloadPath = join(dir, 'payload.txt')
    writeFileSync(payloadPath, 'tree 4b825dc\nauthor octo\n\ncommit body\n')
    const allowedPath = join(dir, 'allowed_signers')
    const [type, blob] = pair.publicKey.split(' ')
    writeFileSync(allowedPath, `${EMAIL} ${type} ${blob}\n`)

    const signed = run({ argv: ['-Y', 'sign', '-n', 'git', '-f', keyPath, payloadPath] })
    expect(signed.code).toBe(0)
    const signaturePath = `${payloadPath}.sig`
    expect(readFileSync(signaturePath, 'utf8')).toContain('BEGIN SSH SIGNATURE')

    const verified = run({
      argv: ['-Y', 'verify', '-n', 'git', '-I', EMAIL, '-f', allowedPath, '-s', signaturePath],
      stdin: readFileSync(payloadPath, 'utf8'),
    })

    expect(verified.code).toBe(0)
    expect(verified.stdout).toContain('Good "git" signature')
  })

  it('fails verification when the payload is altered', () => {
    const pair = generateSigningKeyPair({ comment: 'atlas@octo' })
    const keyPath = writeKey({ name: 'signer-tamper', privateKey: pair.privateKey })
    const payloadPath = join(dir, 'tamper.txt')
    writeFileSync(payloadPath, 'original')
    const allowedPath = join(dir, 'allowed_signers_tamper')
    const [type, blob] = pair.publicKey.split(' ')
    writeFileSync(allowedPath, `${EMAIL} ${type} ${blob}\n`)
    expect(run({ argv: ['-Y', 'sign', '-n', 'git', '-f', keyPath, payloadPath] }).code).toBe(0)

    const verified = run({
      argv: [
        '-Y',
        'verify',
        '-n',
        'git',
        '-I',
        EMAIL,
        '-f',
        allowedPath,
        '-s',
        `${payloadPath}.sig`,
      ],
      stdin: 'tampered',
    })

    expect(verified.code).not.toBe(0)
  })
})
