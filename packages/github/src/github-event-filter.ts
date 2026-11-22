import { deliversEvent, EPrEventKind } from '@dltech/atlas-core'
import { PULL_REQUEST_EVENTS, prEventGroupOf } from '@dltech/atlas-plugin-github/core'
import { z } from 'zod'

const prEventKindSchema = z.enum(EPrEventKind)

export const wantsPrEvent = (args: { events: readonly string[]; kind: string }): boolean => {
  const kind = prEventKindSchema.safeParse(args.kind)
  if (!kind.success) return args.events.length === 0
  return deliversEvent({
    catalog: PULL_REQUEST_EVENTS,
    events: args.events,
    name: prEventGroupOf(kind.data),
  })
}
