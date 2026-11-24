import manifest from '../../../package.json'

const COMMIT_LENGTH = 7
const FULL_COMMIT = /^[0-9a-f]{40}$/

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value

const shortCommitOf = (value: string | undefined): string | undefined => {
  const stamp = nonEmpty(value)
  if (stamp === undefined) return undefined
  return FULL_COMMIT.test(stamp) ? stamp.slice(0, COMMIT_LENGTH) : stamp
}

/** The running API build: a deploy stamp first, then its commit, then the package version. */
export const apiVersion = (args: { env?: Record<string, string | undefined> } = {}): string => {
  const env = args.env ?? process.env
  return (
    shortCommitOf(env.ATLAS_APP_VERSION) ??
    nonEmpty(env.RENDER_GIT_COMMIT)?.slice(0, COMMIT_LENGTH) ??
    nonEmpty(env.VERCEL_GIT_COMMIT_SHA)?.slice(0, COMMIT_LENGTH) ??
    manifest.version
  )
}
