import {
  capabilitiesNote,
  type EnvironmentCapabilities,
  type Event,
  type DraftOfType,
  type EventLogPort,
  type EventOfType,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

export const CAPABILITIES_NOTICE_SLOT = 'session'

export const CAPABILITIES_NOTICE_KEY = 'environment-capabilities'

export const capabilitiesNoticeDraft = (args: {
  capabilities: EnvironmentCapabilities
}): DraftOfType<'context-loaded'> => ({
  type: 'context-loaded',
  slot: CAPABILITIES_NOTICE_SLOT,
  key: CAPABILITIES_NOTICE_KEY,
  content: capabilitiesNote(args.capabilities),
})

export async function syncCapabilitiesNotice(args: {
  log: Pick<EventLogPort, 'append'>
  threadId: ThreadId
  runId: RunId
  events: readonly Event[]
  capabilities: EnvironmentCapabilities
}): Promise<boolean> {
  const draft = capabilitiesNoticeDraft({ capabilities: args.capabilities })
  let current: EventOfType<'context-loaded'> | undefined
  for (const event of args.events) {
    if (event.type !== 'context-loaded') continue
    if (event.slot !== draft.slot || event.key !== draft.key) continue
    current = event
  }
  if (current !== undefined && current.content === draft.content) return false

  await args.log.append({ threadId: args.threadId, runId: args.runId, drafts: [draft] })
  return true
}
