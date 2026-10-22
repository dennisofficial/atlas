import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface GeneratedKey {
  privateKey: string
  publicLine: string
}

export function generateKey(args: { type: 'ed25519' | 'rsa'; passphrase?: string }): GeneratedKey {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-ssh-key-'))
  const path = join(dir, 'key')
  try {
    const bits = args.type === 'rsa' ? ['-b', '2048'] : []
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      args.type,
      ...bits,
      '-N',
      args.passphrase ?? '',
      '-C',
      '',
      '-f',
      path,
    ])
    const publicLine = readFileSync(`${path}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ')
    return { privateKey: readFileSync(path, 'utf8'), publicLine }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
