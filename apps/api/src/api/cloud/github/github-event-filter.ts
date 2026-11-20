import { deliversEvent, type EPrEventKind } from '@dltech/atlas-core'
import { PULL_REQUEST_EVENTS, prEventGroupOf } from '@dltech/atlas-plugin-github/core'

export const wantsPrEvent = (args: { events: readonly string[]; kind: string }): boolean =>
  deliversEvent({
    catalog: PULL_REQUEST_EVENTS,
    events: args.events,
    name: prEventGroupOf(args.kind as EPrEventKind),
  })
