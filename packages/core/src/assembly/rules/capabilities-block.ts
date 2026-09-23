import { wrapInSystemReminder } from '../../context/render'
import type { ThreadId } from '../../events/ids'
import { capabilitiesNote, type EnvironmentCapabilities } from '../../execution/capabilities'
import { defineRule, type Rule } from '../rule'
import { appendedAtTail } from './tail-block'

export type CapabilitiesSource = (args: { threadId: ThreadId }) => EnvironmentCapabilities | undefined

export function capabilitiesBlock(args: { capabilities: CapabilitiesSource }): Rule {
  return defineRule({
    name: 'capabilitiesBlock',
    apply: (input, ctx) => {
      const capabilities = args.capabilities({ threadId: ctx.threadId })
      if (capabilities === undefined) return input

      return appendedAtTail({ input, ctx, text: wrapInSystemReminder(capabilitiesNote(capabilities)) })
    },
  })
}
