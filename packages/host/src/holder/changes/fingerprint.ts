import { createHash } from 'node:crypto'

export type FingerprintedFile = {
  path: string
  status: string
  additions: number
  deletions: number
  baseHash: string | null
  currentHash: string | null
}

const lineOf = (file: FingerprintedFile): string =>
  [
    file.path,
    file.status,
    String(file.additions),
    String(file.deletions),
    file.baseHash ?? '',
    file.currentHash ?? '',
  ].join('\0')

export const fingerprintOf = (files: readonly FingerprintedFile[]): string => {
  const lines = files.map(lineOf).sort()
  return createHash('sha256')
    .update(lines.map((line) => `${line}\n`).join(''))
    .digest('hex')
}
