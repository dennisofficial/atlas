import { createHash } from 'node:crypto'

import { daemonToken, daemonTokenMatches } from '@dltech/atlas-protocol/engine'

export const DAEMON_BUNDLE_ROUTE = 'agent/daemon/bundle'

export const DAEMON_VERSION_HEADER = 'x-atlas-daemon-version'

export type DaemonBundleAnswer =
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'mismatch'; version: string }
  | { kind: 'bundle'; content: Uint8Array }

const BEARER = /^Bearer (.+)$/

const bearerOf = (authorization: string | undefined): string =>
  BEARER.exec(authorization ?? '')?.[1] ?? ''

export const daemonBundleVersionOf = (content: Uint8Array): string =>
  createHash('sha256').update(content).digest('hex')

// The sandbox's boot loop fetches this on every wake, days after the create that handed it the URL,
// so the route authenticates the sandbox's own daemon token rather than a time-limited signature.
// A `version` query names the exact bundle a restarting host wants: any other generation answers
// `mismatch` instead of handing over its own, which is what made a rolling deploy flip the daemon.
export const daemonBundleAnswerOf = async (args: {
  secret: string
  path: string
  authorization: string | undefined
  sandboxName: string | undefined
  version?: string | undefined
}): Promise<DaemonBundleAnswer> => {
  const sandboxName = args.sandboxName ?? ''
  if (sandboxName === '') return { kind: 'forbidden' }
  const want = daemonToken({ secret: args.secret, sandboxName })
  if (!daemonTokenMatches({ want, token: bearerOf(args.authorization) }))
    return { kind: 'forbidden' }
  const file = Bun.file(args.path)
  if (!(await file.exists())) return { kind: 'missing' }
  const content = new Uint8Array(await file.arrayBuffer())
  const version = daemonBundleVersionOf(content)
  if (args.version !== undefined && args.version !== version) return { kind: 'mismatch', version }
  return { kind: 'bundle', content }
}
