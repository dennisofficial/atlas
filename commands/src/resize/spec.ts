import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { sandboxVcpusSchema } from '@dltech/atlas-core'
import { z } from 'zod'

// https://www.agent37.com/docs/agents-api/instance-sizing.md — an Agent37 VM disk tops out at 100 GB
export const RESIZE_MAX_DISK_GB = 100

export const REFUSAL_RESIZE_USAGE = 'Use /resize <vcpus> <memoryGb> [diskGb] [--idle]'

export const resizeArgs = z.strictObject({
  vcpus: sandboxVcpusSchema,
  memoryGb: z.number().int().min(1),
  diskGb: z.number().int().min(1).max(RESIZE_MAX_DISK_GB).optional(),
  whenIdle: z.boolean().optional(),
})

export type ResizeArgs = z.infer<typeof resizeArgs>

const integerOf = (token: string | undefined): number | null => {
  if (token === undefined || !/^\d+$/.test(token)) return null
  return Number(token)
}

const fromText = (argumentText: string): TextArgs => {
  const tokens = argumentText === '' ? [] : argumentText.split(/\s+/)
  const vcpus = integerOf(tokens[0])
  const memoryGb = integerOf(tokens[1])
  if (vcpus === null || memoryGb === null) return { ok: false, reason: REFUSAL_RESIZE_USAGE }

  let diskGb: number | undefined
  let whenIdle = false
  for (const token of tokens.slice(2)) {
    if (token === '--idle' && !whenIdle) {
      whenIdle = true
      continue
    }
    const disk = diskGb === undefined ? integerOf(token) : null
    if (disk === null) return { ok: false, reason: REFUSAL_RESIZE_USAGE }
    diskGb = disk
  }

  const args: ResizeArgs = { vcpus, memoryGb }
  if (diskGb !== undefined) args.diskGb = diskGb
  if (whenIdle) args.whenIdle = true

  const parsed = resizeArgs.safeParse(args)
  if (!parsed.success) return { ok: false, reason: REFUSAL_RESIZE_USAGE }
  return { ok: true, args: parsed.data }
}

export const resize = defineCommand({
  spec: {
    name: 'resize',
    summary: 'Resize this pod and restart its sandbox at the new size, or wait until it is idle',
    group: ECommandGroup.Session,
    argumentHint: '<vcpus> <memoryGb> [diskGb] [--idle]',
    args: resizeArgs,
    runsIn: ECommandRunsIn.Control,
    fromText,
  },
})
