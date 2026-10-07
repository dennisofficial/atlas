import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { writeMeta } from '../store/sessions/meta'

export const FAMILY_OWNERSHIP_FILE = 'workspace-ownership.json'

const checkoutSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  claimedBy: z.string().min(1),
})

export const familyOwnershipSchema = z.object({
  version: z.literal(1),
  rootId: z.string().min(1),
  primaryRepository: z.string().min(1),
  checkouts: z.array(checkoutSchema),
})

export type FamilyOwnership = z.infer<typeof familyOwnershipSchema>
export type FamilyCheckout = FamilyOwnership['checkouts'][number]

const fileOf = ({ sessionDir }: { sessionDir: string }): string => join(sessionDir, FAMILY_OWNERSHIP_FILE)

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

export async function readFamilyOwnership({ sessionDir }: { sessionDir: string }): Promise<FamilyOwnership | null> {
  let raw: string
  try {
    raw = await readFile(fileOf({ sessionDir }), 'utf8')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  return familyOwnershipSchema.parse(JSON.parse(raw))
}

export async function writeFamilyOwnership({
  sessionDir,
  ownership,
}: {
  sessionDir: string
  ownership: FamilyOwnership
}): Promise<void> {
  await writeMeta({ file: fileOf({ sessionDir }), meta: familyOwnershipSchema.parse(ownership) })
}
