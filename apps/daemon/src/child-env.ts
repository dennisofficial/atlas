export const MISE_DATA_DIR_ENV = 'MISE_DATA_DIR'

const DEFAULT_MISE_DATA_DIR = '/opt/mise'

// A mise shim sets these on the process it execs and rewrites PATH to the install it picked. The
// daemon passes its own env to every shell, exec and service it spawns, so a daemon started
// through a shim would hand the whole session the image's bun and node instead of the versions
// the repository pins. /opt/mise/shims resolves those pins from the cwd of each command.
const SHIM_VAR = /^__MISE/

const dataDirOf = (env: Record<string, string | undefined>): string => {
  const value = env[MISE_DATA_DIR_ENV]
  return value === undefined || value === '' ? DEFAULT_MISE_DATA_DIR : value
}

const pathOf = (args: { value: string; installsDir: string }): string =>
  args.value
    .split(':')
    .filter(
      (entry) =>
        entry === '' || (entry !== args.installsDir && !entry.startsWith(`${args.installsDir}/`)),
    )
    .join(':')

export const sanitizeChildEnv = (
  env: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const dataDir = dataDirOf(env)
  const installsDir = `${dataDir}/installs`
  const sanitized: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (SHIM_VAR.test(key)) continue
    sanitized[key] = key === 'PATH' && value !== undefined ? pathOf({ value, installsDir }) : value
  }
  // the shims kept on PATH can no longer reuse the diff this process inherited, so they have to
  // find the installs themselves — a child env without this data dir cannot resolve any tool
  if (typeof sanitized.PATH === 'string') sanitized[MISE_DATA_DIR_ENV] = dataDir
  return sanitized
}
