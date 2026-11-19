/**
 * A call to a tool an MCP server owns, read as the server and the tool within it.
 *
 * The registry names them `mcp__<server>__<tool>`, which is a roster key rather than something a
 * reader should meet. The row says `Paper Get guide`, and the letter tile beside it says which
 * server it was — so the name is parsed once, here, and both surfaces render the pieces.
 */

const MCP_PREFIX = 'mcp__'
const MCP_SEPARATOR = '__'

/** The raw halves of the name, before either is made fit to read. */
export type McpTool = { server: string; tool: string }

/** `mcp__wispr-flow__get_basic_info` → `{ server: 'wispr-flow', tool: 'get_basic_info' }`. */
export function mcpToolOf(name: string): McpTool | null {
  if (!name.startsWith(MCP_PREFIX)) return null

  const rest = name.slice(MCP_PREFIX.length)
  const at = rest.indexOf(MCP_SEPARATOR)
  if (at <= 0) return null

  const server = rest.slice(0, at)
  const tool = rest.slice(at + MCP_SEPARATOR.length)
  if (tool.length === 0) return null

  return { server, tool }
}

const wordsOf = (name: string): string[] => name.split(/[-_\s]+/).filter((word) => word.length > 0)

/** A word already carrying a capital is somebody's name — `Posthog` stays `Posthog`. */
const capitalised = (word: string): string =>
  word[0] === word[0]?.toUpperCase() ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`

/** `wispr-flow` is a handle; `Wispr Flow` is what the row says. */
export function serverLabelOf(server: string): string {
  const words = wordsOf(server)
  return words.length === 0 ? server : words.map(capitalised).join(' ')
}

/** `get_basic_info` reads as a sentence, not as a roster key: `Get basic info`. */
export function toolLabelOf(tool: string): string {
  const [first, ...rest] = wordsOf(tool)
  if (first === undefined) return tool
  return [capitalised(first), ...rest].join(' ')
}

/**
 * The hue a server keeps, so its tile is the same colour in every thread and on every surface.
 *
 * FNV-1a over the server's name: stable across runs, platforms and the two copies of this hash
 * (`packages/ui/src/ai/mcp-server-mark.tsx` carries the same one for its own package).
 */
export function mcpHueOf(server: string): number {
  let hash = 2166136261
  for (let index = 0; index < server.length; index += 1) {
    hash ^= server.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash % 360)
}
