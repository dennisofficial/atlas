import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export const REFUSAL_RESUME_TEXT = 'Resume takes no text. Use /resume, or /resume --agent <id>.'

export const resumeArgs = z.strictObject({ agentId: z.string().min(1).optional() })

export type ResumeArgs = z.infer<typeof resumeArgs>

const AGENT_FLAG = /^--agent[ \t]+(\S+)$/

const resumeFromText = (argumentText: string): TextArgs => {
  const text = argumentText.trim()
  if (text === '') return { ok: true, args: {} }
  const agentId = AGENT_FLAG.exec(text)?.[1]
  if (agentId === undefined) return { ok: false, reason: REFUSAL_RESUME_TEXT }
  return { ok: true, args: { agentId } }
}

export const resume = defineCommand({
  spec: {
    name: 'resume',
    summary: 'Resume a turn that was stopped before it finished',
    group: ECommandGroup.Session,
    argumentHint: '[--agent <id>]',
    args: resumeArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: resumeFromText,
  },
})
