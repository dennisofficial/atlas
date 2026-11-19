import { daemonToken, daemonTokenMatches } from '@dltech/atlas-protocol/engine'

export const DAEMON_BUNDLE_ROUTE = 'agent/daemon/bundle'

export type DaemonBundleAnswer =
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'bundle'; content: Uint8Array }

const BEARER = /^Bearer (.+)$/

const bearerOf = (authorization: string | undefined): string =>
  BEARER.exec(authorization ?? '')?.[1] ?? ''

// The sandbox's boot loop fetches this on every wake, days after the create that handed it the URL,
// so the route authenticates the sandbox's own daemon token rather than a time-limited signature.
export const daemonBundleAnswerOf = async (args: {
  secret: string
  path: string
  authorization: string | undefined
  sandboxName: string | undefined
}): Promise<DaemonBundleAnswer> => {
  const sandboxName = args.sandboxName ?? ''
  if (sandboxName === '') return { kind: 'forbidden' }
  const want = daemonToken({ secret: args.secret, sandboxName })
  if (!daemonTokenMatches({ want, token: bearerOf(args.authorization) }))
    return { kind: 'forbidden' }
  const file = Bun.file(args.path)
  if (!(await file.exists())) return { kind: 'missing' }
  return { kind: 'bundle', content: new Uint8Array(await file.arrayBuffer()) }
}
