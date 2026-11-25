import { EContextSlot, type EventDraft, type RecordEvent } from '@dltech/atlas-core'

import { EMcpServerStatus, type McpServerTools } from './snapshot'

const SLOT = EContextSlot.McpInstructions

const offeredOf = (events: readonly RecordEvent[]): ReadonlyMap<string, string> => {
  const offered = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'context-loaded' || event.slot !== SLOT) continue
    if (event.content === '') offered.delete(event.key)
    else offered.set(event.key, event.content)
  }
  return offered
}

const draftOf = (args: { key: string; content: string }): EventDraft => ({
  type: 'context-loaded',
  slot: SLOT,
  key: args.key,
  content: args.content,
})

const desiredOf = (args: {
  server: McpServerTools | undefined
  offered: string | undefined
}): string => {
  if (args.server === undefined) return ''
  if (args.server.status !== EMcpServerStatus.Connected) return args.offered ?? ''
  return args.server.instructions ?? ''
}

export const mcpInstructionsDraftsOf = (args: {
  events: readonly RecordEvent[]
  servers: readonly McpServerTools[]
}): readonly EventDraft[] => {
  const offered = offeredOf(args.events)
  const byName = new Map(args.servers.map((server) => [server.name, server]))
  const drafts: EventDraft[] = []
  for (const key of new Set([...byName.keys(), ...offered.keys()])) {
    const current = offered.get(key)
    const desired = desiredOf({ server: byName.get(key), offered: current })
    if (desired !== (current ?? '')) drafts.push(draftOf({ key, content: desired }))
  }
  return drafts
}
