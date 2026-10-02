import { createHash } from 'node:crypto'
import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'

export const plainWorkspaceReceiptSchema = z.object({
  version: z.literal(1),
  treeId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  originPath: z.string().min(1),
  baseline: z.string().min(1),
  generation: z.number().int().nonnegative().optional(),
})

export type PlainWorkspaceReceipt = z.infer<typeof plainWorkspaceReceiptSchema>

const RECEIPT_PREFIX = '.atlas-transfer-'
const HASH_LENGTH = 16

export async function plainReceiptPath({ root }: { root: string }): Promise<string> {
  const real = await realpath(root)
  const key = createHash('sha256').update(real).digest('hex').slice(0, HASH_LENGTH)
  return join(dirname(real), `${RECEIPT_PREFIX}${key}.json`)
}

export async function readPlainWorkspaceReceipt({
  path,
}: {
  path: string
}): Promise<PlainWorkspaceReceipt | null> {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  })
  if (text === null) return null
  return plainWorkspaceReceiptSchema.parse(JSON.parse(text))
}

export async function writePlainWorkspaceReceipt({
  path,
  receipt,
}: {
  path: string
  receipt: PlainWorkspaceReceipt
}): Promise<void> {
  const valid = plainWorkspaceReceiptSchema.parse(receipt)
  const partial = join(dirname(path), `${basename(path)}.${process.pid}.tmp`)
  try {
    await writeFile(partial, `${JSON.stringify(valid, null, 2)}\n`)
    await rename(partial, path)
  } finally {
    await rm(partial, { force: true })
  }
}
