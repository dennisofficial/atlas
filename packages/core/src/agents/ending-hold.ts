import type { EventDraft } from '../events/body'
import type { ThreadId } from '../events/ids'
import { EKilledBy } from '../shells/status'
import { isTeammateType } from './kind'
import { EAgentStatus } from './status'

export type CrewRoomMember = {
  agentId: ThreadId
  agentType: string
  group: string | undefined
  running: boolean
}

type EndingDraft = Extract<EventDraft, { type: 'agent-ended' }>

const finishedCleanly = (input: Extract<EventDraft, { type: 'agent-ended' }>): boolean =>
  input.status === EAgentStatus.Finished ||
  (input.status === EAgentStatus.Stopped && input.killedBy === EKilledBy.Model)

const holdableEnding = (input: EventDraft): EndingDraft | undefined => {
  if (input.type !== 'agent-ended') return undefined
  if (isTeammateType(input.agentType)) return undefined
  return input.relayed !== false && finishedCleanly(input) ? input : undefined
}

const groupedMemberOf = (args: {
  agentId: ThreadId
  crew: readonly CrewRoomMember[]
}): CrewRoomMember | undefined => {
  const member = args.crew.find((candidate) => candidate.agentId === args.agentId)
  if (member === undefined || member.group === undefined) return undefined
  return isTeammateType(member.agentType) ? undefined : member
}

const siblingRunning = (args: {
  member: CrewRoomMember
  crew: readonly CrewRoomMember[]
}): boolean =>
  args.crew.some(
    (candidate) =>
      candidate.agentId !== args.member.agentId &&
      candidate.running &&
      candidate.group === args.member.group &&
      !isTeammateType(candidate.agentType),
  )

export const endingHeld = (args: {
  input: EventDraft
  crew: readonly CrewRoomMember[]
}): boolean => {
  const input = holdableEnding(args.input)
  if (input === undefined) return false
  const member = groupedMemberOf({ agentId: input.agentId, crew: args.crew })
  if (member === undefined) return false
  return siblingRunning({ member, crew: args.crew })
}

export const heldDraftOf = (args: {
  input: EventDraft
  crew: readonly CrewRoomMember[]
}): EventDraft => {
  if (!endingHeld(args)) return args.input
  const input = holdableEnding(args.input)
  return input === undefined ? args.input : { ...input, held: true }
}

const withoutHeld = (input: EndingDraft): EndingDraft => {
  const { held: _held, ...rest } = input
  return rest
}

export const unheldDraftOf = (input: EventDraft): EventDraft => {
  const ending = holdableEnding(input)
  if (ending === undefined || ending.held !== true) return input
  return withoutHeld(ending)
}
