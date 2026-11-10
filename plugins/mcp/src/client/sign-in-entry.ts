import type { Event, V2Event } from '@dltech/atlas-core'
import { EAuthor, EEntryKind, type SignInEntry } from '@dltech/atlas-client/transcript'

import { EMcpSignInResult } from '../core/sign-in'

type SignInStarted = Extract<V2Event, { type: 'mcp-sign-in-started' }>
type SignInResolved = Extract<V2Event, { type: 'mcp-sign-in-resolved' }>

type SignInRun = { started: SignInStarted; resolved: SignInResolved | undefined }

const pairKey = (event: SignInStarted | SignInResolved): string => `${event.sessionId}:${event.server}`

const runsOf = (events: readonly (Event | V2Event)[]): ReadonlyMap<string, SignInRun> => {
  const open = new Map<string, string>()
  const runs = new Map<string, SignInRun>()

  for (const event of events) {
    if (event.type === 'mcp-sign-in-started') {
      runs.set(event.id, { started: event, resolved: undefined })
      open.set(pairKey(event), event.id)
      continue
    }
    if (event.type !== 'mcp-sign-in-resolved') continue
    const startedId = open.get(pairKey(event))
    const run = startedId === undefined ? undefined : runs.get(startedId)
    if (startedId === undefined || run === undefined) continue
    runs.set(startedId, { started: run.started, resolved: event })
  }

  return runs
}

const entryOfRun = (run: SignInRun): SignInEntry => {
  const { started, resolved } = run
  const failed =
    resolved === undefined || resolved.reason === undefined ? '' : `: ${resolved.reason}`
  const text =
    resolved === undefined
      ? `sign in to the ${started.server} MCP server: ${started.url}`
      : resolved.result === EMcpSignInResult.Connected
        ? `signed in to the ${started.server} MCP server`
        : `signing in to the ${started.server} MCP server failed${failed}`

  return {
    kind: EEntryKind.SignIn,
    author: EAuthor.Model,
    key: started.id,
    text,
    subject: started.server,
    url: started.url,
    ...(started.expiresAt === undefined ? {} : { expiresAt: started.expiresAt }),
    ...(resolved === undefined ? {} : { result: resolved.result }),
    ...(resolved?.reason === undefined ? {} : { reason: resolved.reason }),
  }
}

/** Two events per sign-in: the row is keyed by the one that drew the card, so it redraws when the other lands. */
export const mcpSignInEntries = (
  events: readonly (Event | V2Event)[],
): ReadonlyMap<string, SignInEntry> => {
  const entries = new Map<string, SignInEntry>()
  for (const [id, run] of runsOf(events)) entries.set(id, entryOfRun(run))
  return entries
}
