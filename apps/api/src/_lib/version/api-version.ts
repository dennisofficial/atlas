import manifest from '../../../package.json'

const COMMIT_LENGTH = 7

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value

/** The running API build: a deploy stamp first, then its commit, then the package version. */
export const apiVersion = (args: { env?: Record<string, string | undefined> } = {}): string => {
  const env = args.env ?? process.env
  return (
    nonEmpty(env.ATLAS_APP_VERSION) ??
    nonEmpty(env.RENDER_GIT_COMMIT)?.slice(0, COMMIT_LENGTH) ??
    nonEmpty(env.VERCEL_GIT_COMMIT_SHA)?.slice(0, COMMIT_LENGTH) ??
    manifest.version
  )
}
