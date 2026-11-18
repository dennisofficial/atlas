import { createHash } from 'node:crypto'

export abstract class ChangeContentStore {
  abstract put(args: { hash: string; bytes: Uint8Array }): Promise<void>
  abstract read(args: { hash: string }): Promise<Uint8Array | null>
  abstract presignGet(args: { hash: string; ttlMs: number }): Promise<string>
  abstract removing(hashes: readonly string[]): Promise<void>
  abstract list(): Promise<readonly ChangeBlobRow[]>
}

export type ChangeBlobRow = { hash: string; size: number; createdAt: number }

export const changeBlobKey = (args: { prefix: string; hash: string }): string =>
  `${args.prefix}/sha256/${args.hash.slice(0, 2)}/${args.hash}`

export const changeHashOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')
