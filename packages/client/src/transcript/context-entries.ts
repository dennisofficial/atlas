import {
  EContextSlot,
  EExecutionLocation,
  ELocationChangeCause,
  type Event,
  type EventId,
  type EventOfType,
} from '@dltech/atlas-core'

import {
  EAuthor,
  EEntryKind,
  type SystemContextEntry,
  type SystemContextItem,
} from './transcript-model'

export type AttachedContext = { skills: readonly string[]; files: readonly string[] }

export const NOTHING_ATTACHED: AttachedContext = { skills: [], files: [] }

export function contextLoadedWith(events: readonly Event[]): {
  attached: ReadonlyMap<EventId, AttachedContext>
  folded: ReadonlySet<EventId>
} {
  const attached = new Map<EventId, AttachedContext>()
  const folded = new Set<EventId>()
  let skills: string[] = []
  let files: string[] = []
  let pending: EventId[] = []

  for (const event of events) {
    if (event.type === 'context-loaded') {
      if (event.slot === EContextSlot.Skill) skills.push(event.key)
      if (event.slot === EContextSlot.File) files.push(event.key)
      pending.push(event.id)
      continue
    }

    if (event.type === 'user-said' && skills.length + files.length > 0) {
      attached.set(event.id, { skills, files })
      for (const id of pending) folded.add(id)
    }
    skills = []
    files = []
    pending = []
  }

  return { attached, folded }
}

const KNOWN_SLOT_LABELS: ReadonlyMap<string, string> = new Map([
  [EContextSlot.UserInstructions, 'global instructions'],
  [EContextSlot.ProjectInstructions, 'project instructions'],
  [EContextSlot.NestedInstructions, 'directory instructions'],
  [EContextSlot.SkillListing, 'skill listing'],
  [EContextSlot.McpInstructions, 'MCP server instructions'],
])

const SKILL_SUGGESTION_NAME = /skill classifier picked '([a-z0-9-]+)' as relevant/

const slotLabelOf = (event: EventOfType<'context-loaded'>): string => {
  const label = KNOWN_SLOT_LABELS.get(event.slot)
  if (label !== undefined) return label
  if (event.slot === 'skill-suggestion') {
    const name = SKILL_SUGGESTION_NAME.exec(event.content)?.[1]
    return name === undefined ? 'skill suggestion' : `skill suggestion · ${name}`
  }
  if (event.slot === 'plan') return 'plan mirror'
  if (event.slot === 'outside-project') return 'outside-project warning'
  return event.slot.replaceAll('-', ' ')
}

// #1252 stopped recording relocation artifacts (a lift-era location-changed marker and a
// session-slot context injection) for born-placed sessions; logs written before it still carry
// them. The renderer drops them by shape — a move to or from the cloud means a relocation, since
// genuine moves under born-placed stay between host and docker — while the read paths in core
// (worktree anchors, rewind) keep folding the events themselves.
export const isRelocationMarker = (event: EventOfType<'location-changed'>): boolean => {
  if (event.cause === ELocationChangeCause.SandboxExpired) return false
  return event.from === EExecutionLocation.Cloud || event.to === EExecutionLocation.Cloud
}

const isRelocationInjection = (event: EventOfType<'context-loaded'>): boolean =>
  event.slot === 'session' && event.key === 'execution-location'

const injectionsSummary = (items: readonly SystemContextItem[]): string =>
  items.length === 1 ? (items[0]?.label ?? '') : `${items.length} prompts`

export function contextRuns(args: {
  events: readonly Event[]
  isHidden: (id: EventId) => boolean
  current: ReadonlySet<EventId>
}): ReadonlyMap<EventId, SystemContextEntry> {
  const runs = new Map<EventId, SystemContextEntry>()
  let open: { anchor: EventId; items: SystemContextItem[] } | undefined

  const close = (): void => {
    if (open === undefined) return
    runs.set(open.anchor, {
      kind: EEntryKind.SystemContext,
      author: EAuthor.Model,
      key: open.anchor,
      text: injectionsSummary(open.items),
      items: open.items,
    })
    open = undefined
  }

  for (const event of args.events) {
    if (event.type !== 'context-loaded') {
      close()
      continue
    }
    if (args.isHidden(event.id)) continue
    if (isRelocationInjection(event)) continue

    const item: SystemContextItem = {
      key: event.id,
      label: slotLabelOf(event),
      content: event.content,
      superseded: !args.current.has(event.id),
    }
    if (open === undefined) open = { anchor: event.id, items: [item] }
    else open.items.push(item)
  }
  close()

  return runs
}
