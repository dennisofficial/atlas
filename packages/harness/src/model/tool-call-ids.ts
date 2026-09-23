import type { ModelMessage } from 'ai'

// Anthropic's messages API rejects a tool_use id outside this pattern with a 400, so ids a
// previous provider in the thread generated — kimi numbers calls as `bash:16` — must be
// rewritten before a prompt can cross providers. Applied to every request: the pattern is the
// strictest any provider enforces, and the ids are request-local.
const SAFE_TOOL_CALL_ID = /^[a-zA-Z0-9_-]+$/
const UNSAFE_ID_CHARS = /[^a-zA-Z0-9_-]/g

const FALLBACK_ID = 'call'

function toolCallIdsOf(messages: readonly ModelMessage[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'tool-call') ids.push(part.toolCallId)
      }
    }
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') ids.push(part.toolCallId)
      }
    }
  }
  return ids
}

function replacementsFor(ids: readonly string[]): Map<string, string> {
  const taken = new Set(ids)
  const replacements = new Map<string, string>()

  for (const id of ids) {
    if (SAFE_TOOL_CALL_ID.test(id) || replacements.has(id)) continue

    let candidate = id.replace(UNSAFE_ID_CHARS, '_')
    if (candidate.length === 0) candidate = FALLBACK_ID
    while (taken.has(candidate)) candidate = `${candidate}_`

    replacements.set(id, candidate)
    taken.add(candidate)
  }

  return replacements
}

export function sanitizeToolCallIds(messages: readonly ModelMessage[]): ModelMessage[] {
  const replacements = replacementsFor(toolCallIdsOf(messages))
  if (replacements.size === 0) return [...messages]

  const rewrite = (id: string): string => replacements.get(id) ?? id

  return messages.map((message) => {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === 'tool-call' ? { ...part, toolCallId: rewrite(part.toolCallId) } : part,
        ),
      }
    }
    if (message.role === 'tool') {
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === 'tool-result' ? { ...part, toolCallId: rewrite(part.toolCallId) } : part,
        ),
      }
    }
    return message
  })
}
