import type { ThreadId } from '../events/ids'

export const SERVICE_PORT_FLOOR = 20_000
export const SERVICE_PORT_SPAN = 10_000

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function deriveServicePort({
  threadId,
  name,
}: {
  threadId: ThreadId
  name: string
}): number {
  let hash = FNV_OFFSET
  for (const character of `${threadId}:${name}`) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV_PRIME) >>> 0
  }
  return SERVICE_PORT_FLOOR + (hash % SERVICE_PORT_SPAN)
}

export function nextServicePort({ port }: { port: number }): number {
  return SERVICE_PORT_FLOOR + ((port - SERVICE_PORT_FLOOR + 1) % SERVICE_PORT_SPAN)
}
