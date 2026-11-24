import { systemContext } from '../../context/envelope'
import { currentContextEvents } from '../../context/supersede'
import { latestRotationOf } from '../../record/rotation'
import { defineRule, type Rule } from '../rule'

const HANDOFF_PREFACE =
  'This thread was rotated. You wake with only this brief of the work before it.'

export function rotatedHandoff(): Rule {
  return defineRule({
    name: 'rotatedHandoff',
    apply: (input, ctx) => {
      const point = latestRotationOf(ctx.events)
      if (point === undefined) return input
      const current = new Set(currentContextEvents(ctx.events).map((event) => event.id))
      const carried = input.messages.filter(
        (entry) => entry.origin.seq < point.seq && current.has(entry.origin.eventId),
      )
      const kept = input.messages.filter((entry) => entry.origin.seq >= point.seq)
      return {
        system: input.system,
        messages: [
          {
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: systemContext({
                    slot: 'rotation',
                    key: 'handoff',
                    content: `${HANDOFF_PREFACE}\n\n${point.handoff}`,
                  }),
                },
              ],
            },
            origin: { eventId: point.id, seq: point.seq },
          },
          ...carried,
          ...kept,
        ],
      }
    },
  })
}
