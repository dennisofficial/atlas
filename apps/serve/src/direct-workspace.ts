import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { z } from 'zod'

import {
  EWorkspaceRestoreMode,
  restoreWorkspaceArchive,
  type RestoredWorkspace,
} from '@dltech/atlas-harness'
import { restoredWorkspaceWireSchema } from '@dltech/atlas-wire'

import { driveWorkspaceArchivePath, driveWorkspaceReceiptPath } from './drive-bootstrap'

const receiptSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  restored: restoredWorkspaceWireSchema,
  arrivalPending: z.boolean(),
  activated: z.boolean(),
})

export type DirectReceipt = z.infer<typeof receiptSchema>

export type DirectWorkspaceRestorer = (args: {
  archivePath: string
  destination: string
  mode: EWorkspaceRestoreMode.Cloud
}) => Promise<RestoredWorkspace>

export type DirectApply = {
  applied: boolean
  restored: RestoredWorkspace
  arrivalPending: boolean
  activated: boolean
}

export type DirectBoot =
  | { kind: 'none' }
  | { kind: 'ready'; result: DirectApply }
  | { kind: 'failed'; reason: string }

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the workspace restore failed for a reason it did not name'

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function readDirectReceipt(args: { driveHome: string }): Promise<DirectReceipt | null> {
  try {
    const text = await readFile(driveWorkspaceReceiptPath(args), 'utf8')
    return receiptSchema.parse(JSON.parse(text))
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

const writeReceipt = async (args: { driveHome: string; receipt: DirectReceipt }): Promise<void> => {
  const path = driveWorkspaceReceiptPath(args)
  const staging = `${path}.${randomBytes(4).toString('hex')}.partial`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(staging, JSON.stringify(args.receipt))
  await rename(staging, path)
}

const resultOf = (args: { applied: boolean; receipt: DirectReceipt }): DirectApply => ({
  applied: args.applied,
  restored: args.receipt.restored,
  arrivalPending: args.receipt.arrivalPending,
  activated: args.receipt.activated,
})

export function createDirectWorkspace(args: {
  driveHome: string
  destination: string
  restore?: DirectWorkspaceRestorer | undefined
}) {
  const restore = args.restore ?? restoreWorkspaceArchive
  const archivePath = driveWorkspaceArchivePath(args)
  let active: string | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const applyOnce = async (): Promise<DirectApply | null> => {
    const receipt = await readDirectReceipt(args)
    let sha256: string
    try {
      sha256 = await sha256OfFile(archivePath)
    } catch (error) {
      if (!isMissing(error)) throw error
      if (receipt === null) return null
      active = receipt.restored.cwd
      return resultOf({ applied: false, receipt })
    }
    if (receipt?.sha256 === sha256) {
      await rm(archivePath, { force: true })
      active = receipt.restored.cwd
      return resultOf({ applied: false, receipt })
    }
    const restored = await restore({
      archivePath,
      destination: args.destination,
      mode: EWorkspaceRestoreMode.Cloud,
    })
    const next: DirectReceipt = {
      sha256,
      restored: { ...restored, trees: [...restored.trees] },
      arrivalPending: true,
      activated: false,
    }
    await writeReceipt({ driveHome: args.driveHome, receipt: next })
    await rm(archivePath, { force: true })
    active = restored.cwd
    return resultOf({ applied: true, receipt: next })
  }

  const apply = (): Promise<DirectApply | null> => {
    const run = queue.then(applyOnce, applyOnce)
    queue = run.catch(() => undefined)
    return run
  }

  const boot = async (): Promise<DirectBoot> => {
    try {
      const result = await apply()
      return result === null ? { kind: 'none' } : { kind: 'ready', result }
    } catch (error) {
      return { kind: 'failed', reason: messageOf(error) }
    }
  }

  const markArrived = async (): Promise<void> => {
    const receipt = await readDirectReceipt(args)
    if (receipt === null || !receipt.arrivalPending) return
    await writeReceipt({ driveHome: args.driveHome, receipt: { ...receipt, arrivalPending: false } })
  }

  const markActivated = async (): Promise<void> => {
    const receipt = await readDirectReceipt(args)
    if (receipt === null || receipt.activated) return
    await writeReceipt({ driveHome: args.driveHome, receipt: { ...receipt, activated: true } })
  }

  return {
    apply,
    boot,
    markArrived,
    markActivated,
    activeCwd: (): string | null => active,
    receipt: (): Promise<DirectReceipt | null> => readDirectReceipt(args),
  }
}

export type DirectWorkspace = ReturnType<typeof createDirectWorkspace>
