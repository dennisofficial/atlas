import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { sandboxRotationReceiptSchema, sandboxRotationStateSchema, type SandboxRotationReceipt, type SandboxRotationState } from '@dltech/atlas-wire'

export const SANDBOX_ROTATION_RECEIPT_RELATIVE_PATH = 'operational/sandbox-rotation.json'

export const sandboxRotationReceiptFile = (args: { atlasHome: string }): string =>
  join(args.atlasHome, SANDBOX_ROTATION_RECEIPT_RELATIVE_PATH)

export async function readSandboxRotationState(args: {
  atlasHome: string
}): Promise<SandboxRotationState | null> {
  const file = sandboxRotationReceiptFile(args)
  const text = await readFile(file, 'utf8').catch((failure: unknown) => {
    if (failure instanceof Error && 'code' in failure && failure.code === 'ENOENT') return null
    throw failure
  })
  if (text === null) return null
  return sandboxRotationStateSchema.parse(JSON.parse(text))
}

export async function readSandboxRotationReceipt(args: { atlasHome: string }): Promise<SandboxRotationReceipt | null> {
  const stored = await readSandboxRotationState(args)
  const parsed = sandboxRotationReceiptSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}

export async function persistSandboxRotationIntent(args: {
  atlasHome: string
  threadId: string
  sandboxSessionId: string
  resumeParent: boolean
  resumeChildren?: readonly string[] | undefined
}): Promise<void> {
  await persistSandboxRotationState({
    atlasHome: args.atlasHome,
    state: {
      version: 1, preparing: true, threadId: args.threadId, sandboxSessionId: args.sandboxSessionId,
      resumeParent: args.resumeParent,
      ...(args.resumeChildren === undefined ? {} : { resumeChildren: [...args.resumeChildren] }),
    },
  })
}

export async function persistSandboxRotationReceipt(args: {
  atlasHome: string
  receipt: SandboxRotationReceipt
}): Promise<void> {
  await persistSandboxRotationState({ atlasHome: args.atlasHome, state: args.receipt })
}

export async function persistSandboxRotationState(args: {
  atlasHome: string
  state: SandboxRotationState
}): Promise<void> {
  const state = sandboxRotationStateSchema.parse(args.state)
  const file = sandboxRotationReceiptFile(args)
  const directory = dirname(file)
  await mkdir(directory, { recursive: true })
  const staging = join(directory, `.${randomUUID()}.tmp`)
  const handle = await open(staging, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(staging, file)
  const parent = await open(directory, 'r')
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}
