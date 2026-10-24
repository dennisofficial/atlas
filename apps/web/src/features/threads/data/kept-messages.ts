import type { AtlasStepMessage } from '@dltech/atlas-client/chat'
import { stepsOfMessages } from '@dltech/atlas-client/chat'
import { liveSteps } from '@dltech/atlas-client/transcript'
import type { Event } from '@dltech/atlas-core'

export function keptMessages(args: {
  messages: readonly AtlasStepMessage[]
  events: readonly Event[]
}): readonly AtlasStepMessage[] {
  const steps = stepsOfMessages(args.messages)
  const shown = new Set(liveSteps({ steps, events: args.events }))
  if (shown.size === args.messages.length) return args.messages
  return args.messages.filter((_, index) => {
    const step = steps[index]
    return step !== undefined && shown.has(step)
  })
}
