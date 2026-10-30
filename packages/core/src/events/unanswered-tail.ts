import { EContextSlot } from '../context/slot'
import type { EventDraft } from './body'
import { saidBy, EMessageOrigin } from './body'
import type { Event, EventOfType } from './envelope'

export type UnansweredTail = {
  operatorMessages: readonly EventOfType<'user-said'>[]
  loadedSkills: readonly Event[]
}

export function unansweredTail(events: readonly Event[]): UnansweredTail {
  const tail = events.slice(events.findLastIndex((event) => event.type === 'assistant-said') + 1)
  return {
    operatorMessages: tail.filter(
      (event): event is EventOfType<'user-said'> =>
        event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator,
    ),
    loadedSkills: tail.filter(
      (event) => event.type === 'context-loaded' && event.slot === EContextSlot.Skill,
    ),
  }
}

export function unexpandedSkillDrafts({
  events,
  expand,
}: {
  events: readonly Event[]
  expand: (args: { text: string; context: readonly EventDraft[] }) => readonly EventDraft[]
}): readonly EventDraft[] {
  const { operatorMessages, loadedSkills } = unansweredTail(events)
  const added: EventDraft[] = []
  for (const message of operatorMessages) {
    added.push(...expand({ text: message.text, context: [...loadedSkills, ...added] }))
  }
  return added
}
