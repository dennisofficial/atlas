import { EContextSlot } from '../context/slot'

export type ContextPart = { label: string; tokens: number }

type Row = { label: string; chars: number }

const PROMPT_PREFIX = 'system.prompt.'
const CONTEXT_PREFIX = 'messages.context.'
const MCP_PREFIX = 'tools.mcp.'
const MCP_COUNT_SUFFIX = '.count'
const CONVERSATION = 'Conversation'

const charsOf = (sizes: Readonly<Record<string, number>>, key: string): number => sizes[key] ?? 0

const sumOf = (args: {
  sizes: Readonly<Record<string, number>>
  include: (key: string) => boolean
}): number => {
  let total = 0
  for (const [key, chars] of Object.entries(args.sizes)) {
    if (args.include(key)) total += chars
  }
  return total
}

const promptCharsOf = (sizes: Readonly<Record<string, number>>, prefix: string): number =>
  sumOf({ sizes, include: (key) => key.startsWith(prefix) })

const contextCharsOf = (sizes: Readonly<Record<string, number>>, slot: EContextSlot): number =>
  charsOf(sizes, `${CONTEXT_PREFIX}${slot}`)

const mcpServersOf = (sizes: Readonly<Record<string, number>>): readonly string[] =>
  Object.keys(sizes)
    .filter((key) => key.startsWith(MCP_PREFIX) && key.endsWith(MCP_COUNT_SUFFIX))
    .map((key) => key.slice(MCP_PREFIX.length, key.length - MCP_COUNT_SUFFIX.length))
    .sort()

const rowsOf = (sizes: Readonly<Record<string, number>>): readonly Row[] => {
  const system = sumOf({
    sizes,
    include: (key) => key.startsWith('system.') && !key.startsWith(PROMPT_PREFIX),
  })
  const skillsPrompt = promptCharsOf(sizes, `${PROMPT_PREFIX}skills.`)
  const memoryPrompt = promptCharsOf(sizes, `${PROMPT_PREFIX}memory.`)
  const contextChars = sumOf({ sizes, include: (key) => key.startsWith(CONTEXT_PREFIX) })
  const toolResults = charsOf(sizes, 'messages.tool-results')

  return [
    { label: 'System prompt', chars: Math.max(0, system - skillsPrompt - memoryPrompt) },
    {
      label: 'Skills',
      chars:
        skillsPrompt +
        contextCharsOf(sizes, EContextSlot.SkillListing) +
        contextCharsOf(sizes, EContextSlot.Skill),
    },
    { label: 'Memory', chars: memoryPrompt },
    {
      label: 'Instructions',
      chars:
        contextCharsOf(sizes, EContextSlot.UserInstructions) +
        contextCharsOf(sizes, EContextSlot.ProjectInstructions) +
        contextCharsOf(sizes, EContextSlot.NestedInstructions) +
        contextCharsOf(sizes, EContextSlot.McpInstructions),
    },
    { label: 'Tools', chars: charsOf(sizes, 'tools.builtin') },
    ...mcpServersOf(sizes).map((server) => ({
      label: `MCP: ${server}`,
      chars: charsOf(sizes, `${MCP_PREFIX}${server}`),
    })),
    { label: 'Tool results', chars: toolResults },
    {
      label: CONVERSATION,
      chars: Math.max(0, charsOf(sizes, 'messages') - contextChars - toolResults),
    },
  ]
}

const splitTokens = (args: { rows: readonly Row[]; inputTokens: number }): number[] => {
  const totalChars = args.rows.reduce((total, row) => total + row.chars, 0)
  const tokens = args.rows.map((row) => Math.floor((args.inputTokens * row.chars) / totalChars))
  const spent = tokens.reduce((total, value) => total + value, 0)
  const remainder = args.inputTokens - spent
  if (remainder <= 0) return tokens

  let largest = 0
  args.rows.forEach((row, index) => {
    if (row.chars > (args.rows[largest]?.chars ?? 0)) largest = index
  })
  tokens[largest] = (tokens[largest] ?? 0) + remainder
  return tokens
}

export function contextBreakdownOf(args: {
  sizes: Readonly<Record<string, number>>
  inputTokens: number
  outputTokens: number
}): readonly ContextPart[] {
  const inputTokens = Math.max(0, Math.floor(args.inputTokens))
  const outputTokens = Math.max(0, Math.floor(args.outputTokens))
  const rows = rowsOf(args.sizes).filter(
    (row) => row.chars > 0 || (row.label === CONVERSATION && outputTokens > 0),
  )
  const totalChars = rows.reduce((total, row) => total + row.chars, 0)
  if (totalChars === 0) return []

  const tokens = splitTokens({ rows, inputTokens })
  const parts = rows.map((row, index) => ({
    label: row.label,
    tokens: (tokens[index] ?? 0) + (row.label === CONVERSATION ? outputTokens : 0),
  }))
  return parts.filter((part) => part.tokens > 0)
}
