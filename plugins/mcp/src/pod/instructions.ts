import { EContextSlot, type EventDraft } from '@dltech/atlas-core'

export const mcpInstructionsDraftsOf = (args: {
  previous: ReadonlyMap<string, string>
  next: ReadonlyMap<string, string>
}): readonly EventDraft[] => [
  ...[...args.next]
    .filter(([name, text]) => args.previous.get(name) !== text)
    .map(([key, content]) => ({
      type: 'context-loaded' as const,
      slot: EContextSlot.McpInstructions,
      key,
      content,
    })),
  ...[...args.previous.keys()]
    .filter((name) => !args.next.has(name))
    .map((key) => ({
      type: 'context-loaded' as const,
      slot: EContextSlot.McpInstructions,
      key,
      content: '',
    })),
]
