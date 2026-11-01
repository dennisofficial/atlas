const MAX_CHAIN_LINKS = 8

const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

export function causeChainOf(error: unknown): unknown[] {
  const links: unknown[] = []
  const seen = new Set<unknown>()
  let current = error

  while (links.length < MAX_CHAIN_LINKS && !seen.has(current)) {
    links.push(current)
    if (!isObject(current)) break
    seen.add(current)

    const next = current as { cause?: unknown; lastError?: unknown }
    current = next.cause ?? next.lastError
    if (current === undefined) break
  }
  return links
}
