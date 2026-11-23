import { z } from 'zod'

export const DIAGRAM_REPAIR_SYSTEM = [
  'You fix Mermaid diagrams that fail to parse.',
  'Keep the diagram type, nodes, edges and wording; change only what the parser rejects, such as',
  'unquoted labels holding punctuation, semicolons or arrow-like text inside a message, or reserved',
  'words used as ids.',
  'Reply with the corrected Mermaid source and nothing else: no fence, no explanation.',
].join('\n')

export const DIAGRAM_SOURCE_MAX = 20_000
export const DIAGRAM_ERROR_MAX = 4_000

export const diagramRepairPrompt = (args: {
  source: string
  error: string
  context?: string | undefined
}): string => {
  const context = args.context?.trim() ?? ''
  return [
    'Parser error:',
    args.error.trim(),
    '',
    ...(context.length === 0 ? [] : ['Text around the diagram:', context, '']),
    'Diagram source:',
    args.source.trim(),
  ].join('\n')
}

const FENCED = /^`{3,}[ \t]*(?:mermaid)?[ \t]*\n([\s\S]*?)\n`{3,}\s*$/i

export function repairedSourceOf(reply: string): string | undefined {
  const trimmed = reply.trim()
  const source = (FENCED.exec(trimmed)?.[1] ?? trimmed).trim()
  return source.length === 0 ? undefined : source
}

export enum EDiagramRepair {
  Repaired = 'repaired',
  Failed = 'failed',
}

export type DiagramRepairOutcome =
  | { kind: EDiagramRepair.Repaired; repaired: string }
  | { kind: EDiagramRepair.Failed; reason: string }

export const diagramRepairOutcomeSchema: z.ZodType<DiagramRepairOutcome> = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal(EDiagramRepair.Repaired), repaired: z.string().min(1) }),
    z.strictObject({ kind: z.literal(EDiagramRepair.Failed), reason: z.string().min(1) }),
  ],
)

export const DIAGRAM_REPAIR_EMPTY = 'the model returned no diagram'
export const DIAGRAM_REPAIR_UNCHANGED = 'the model returned the diagram unchanged'

export function diagramRepairOutcomeOf(args: {
  source: string
  reply: string
}): DiagramRepairOutcome {
  const repaired = repairedSourceOf(args.reply)
  if (repaired === undefined) return { kind: EDiagramRepair.Failed, reason: DIAGRAM_REPAIR_EMPTY }
  if (repaired === args.source.trim()) {
    return { kind: EDiagramRepair.Failed, reason: DIAGRAM_REPAIR_UNCHANGED }
  }
  return { kind: EDiagramRepair.Repaired, repaired }
}
