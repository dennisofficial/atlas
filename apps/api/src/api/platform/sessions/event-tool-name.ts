const TOOL_CALLED = 'tool-called'

const nameInBody = (body: string): string | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) return null
  return typeof parsed.name === 'string' ? parsed.name : null
}

export const toolNameOf = (event: { type: string; body: string }): string | null =>
  event.type === TOOL_CALLED ? nameInBody(event.body) : null
