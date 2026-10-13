import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'

import { writeFileAtomically } from '../files/atomic-write'

const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export const sha256Hex = (content: Uint8Array | string): string =>
  createHash('sha256').update(content).digest('hex')

export const decodeText = (bytes: Uint8Array): string | null => {
  try {
    return strictDecoder.decode(bytes)
  } catch {
    return null
  }
}

export type LocalText = { content: string; bytes: Buffer; hash: string }

export type LocalRead = { exists: false } | { exists: true; text: LocalText | null }

export async function readLocalFile(path: string): Promise<LocalRead> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return { exists: false }
  }
  const content = decodeText(bytes)
  return { exists: true, text: content === null ? null : { content, bytes, hash: sha256Hex(bytes) } }
}

export async function writeLocalFile(args: { path: string; content: string }): Promise<void> {
  await writeFileAtomically({ path: args.path, content: args.content })
}

export async function removeLocalFile(path: string): Promise<void> {
  await rm(path, { force: true })
}
