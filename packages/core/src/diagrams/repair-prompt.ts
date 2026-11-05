export const DIAGRAM_REPAIR_SYSTEM = [
  'You fix Mermaid diagrams that fail to parse.',
  'Keep the diagram type, nodes, edges and wording; change only what the parser rejects, such as',
  'unquoted labels holding punctuation, semicolons or arrow-like text inside a message, or reserved',
  'words used as ids.',
  'Reply with the corrected Mermaid source and nothing else: no fence, no explanation.',
].join('\n')

export const diagramRepairPrompt = (args: { source: string; error: string }): string =>
  ['Parser error:', args.error.trim(), '', 'Diagram source:', args.source.trim()].join('\n')

const FENCED = /^`{3,}[ \t]*(?:mermaid)?[ \t]*\n([\s\S]*?)\n`{3,}\s*$/i

export function repairedSourceOf(reply: string): string | undefined {
  const trimmed = reply.trim()
  const source = (FENCED.exec(trimmed)?.[1] ?? trimmed).trim()
  return source.length === 0 ? undefined : source
}
