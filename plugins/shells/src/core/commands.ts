import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export const shellKillArgs = z.strictObject({ shellId: z.string().min(1) })

export type ShellKillArgs = z.infer<typeof shellKillArgs>

export const REFUSAL_SHELL_KILL_ID = 'Use /shell-kill <id>'

const shellKillFromText = (argumentText: string): TextArgs => {
  const shellId = argumentText.trim()
  if (shellId === '' || /\s/.test(shellId)) return { ok: false, reason: REFUSAL_SHELL_KILL_ID }
  return { ok: true, args: { shellId } }
}

export const shellKill = defineCommand({
  spec: {
    name: 'shell-kill',
    summary: 'Stop a running background shell',
    group: ECommandGroup.Session,
    argumentHint: '<id>',
    args: shellKillArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: shellKillFromText,
    listed: false,
  },
})

export const shellKillCommands = [shellKill]
