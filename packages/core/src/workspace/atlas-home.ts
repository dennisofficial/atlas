export const ATLAS_HOME_ENV = 'ATLAS_HOME'
export const ATLAS_DIRECTORY_NAME = '.atlas'
export const ATLAS_TESTING_ENV = 'ATLAS_TESTING'
export const ATLAS_ALLOW_REAL_HOME_ENV = 'ATLAS_ALLOW_REAL_HOME'

const SCRATCH_DIRECTORY_NAME = '.atlas-home'

const SEPARATOR = '/'

const withoutTrailingSeparator = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.length === 0 ? SEPARATOR : trimmed
}

const under = (args: { directory: string; name: string }): string =>
  `${withoutTrailingSeparator(args.directory)}${SEPARATOR}${args.name}`

// bun test sets NODE_ENV=test itself; no other passive signal survives a `bun run` of the same file
// (the test globals register identically in both, execArgv is empty, import.meta.main is true in both).
// ATLAS_TESTING is the explicit signal the repo's test entrypoints export.
const underTestRunner = (env: Record<string, string | undefined>): boolean =>
  env[ATLAS_TESTING_ENV] === '1' || env.NODE_ENV === 'test'

const escapeHatchOpen = (env: Record<string, string | undefined>): boolean =>
  env[ATLAS_ALLOW_REAL_HOME_ENV] === '1'

const underDirectory = (args: { path: string; directory: string }): boolean => {
  const directory = withoutTrailingSeparator(args.directory)
  return args.path === directory || args.path.startsWith(`${directory}${SEPARATOR}`)
}

const SCRATCH_SUFFIX = `${SEPARATOR}${SCRATCH_DIRECTORY_NAME}`

const isSafeTestHome = (args: { path: string; tempDir?: string | undefined }): boolean => {
  if (args.tempDir !== undefined && underDirectory({ path: args.path, directory: args.tempDir }))
    return true
  return args.path.endsWith(SCRATCH_SUFFIX) || args.path.includes(`${SCRATCH_SUFFIX}${SEPARATOR}`)
}

export function atlasHomeFrom(args: {
  env: Record<string, string | undefined>
  home: string
  tempDir?: string
}): string {
  const named = args.env[ATLAS_HOME_ENV]
  const hasNamed = named !== undefined && named.length > 0
  const resolved = hasNamed
    ? withoutTrailingSeparator(named)
    : under({ directory: args.home, name: ATLAS_DIRECTORY_NAME })

  if (!underTestRunner(args.env)) return resolved
  if (escapeHatchOpen(args.env)) return resolved
  if (hasNamed && isSafeTestHome({ path: resolved, tempDir: args.tempDir })) return resolved

  throw new Error(
    `atlasHomeFrom refused the real Atlas home (${resolved}) under a test runner. ` +
      `Point ${ATLAS_HOME_ENV} at a temp dir, or set ${ATLAS_ALLOW_REAL_HOME_ENV}=1 for a spec that genuinely needs real credentials.`,
  )
}
