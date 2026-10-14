import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { writeMeta } from '../store/sessions/meta'

export const MIRROR_STAMP_NAME = '.mirror-stamp.json'

export const mirrorStampSchema = z.object({
  v: z.literal(1),
  revision: z.number().int().nonnegative(),
  syncedAt: z.string(),
  files: z.record(z.string(), z.object({ bytes: z.number().int().nonnegative(), sha256: z.string() })),
})
export type MirrorStamp = z.infer<typeof mirrorStampSchema>

export function mirrorStampFile({ sessionDir }: { sessionDir: string }): string {
  return join(sessionDir, MIRROR_STAMP_NAME)
}

export async function readMirrorStamp(args: { sessionDir: string }): Promise<MirrorStamp | undefined> {
  const file = mirrorStampFile(args)
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined
  try {
    return mirrorStampSchema.parse(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export async function writeMirrorStamp(args: { sessionDir: string; stamp: MirrorStamp }): Promise<void> {
  await writeMeta({ file: mirrorStampFile(args), meta: args.stamp })
}
