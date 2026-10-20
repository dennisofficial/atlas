export const PUSH_COMMAND = 'push'

const YES_FLAGS: readonly string[] = ['--yes', '-y']
const HELP_FLAGS: readonly string[] = ['--help', '-h']
const ALL_FLAGS: readonly string[] = ['--all']
const KNOWN_FLAGS: readonly string[] = [...YES_FLAGS, ...HELP_FLAGS, ...ALL_FLAGS]

export type PushRequest = { yes: boolean; help: boolean; all: boolean; unknown: readonly string[] }

export function pushRequestOf({ argv }: { argv: readonly string[] }): PushRequest | undefined {
  if (argv[0] !== PUSH_COMMAND) return undefined

  const flags = argv.slice(1)
  return {
    yes: flags.some((flag) => YES_FLAGS.includes(flag)),
    help: flags.some((flag) => HELP_FLAGS.includes(flag)),
    all: flags.some((flag) => ALL_FLAGS.includes(flag)),
    unknown: flags.filter((flag) => !KNOWN_FLAGS.includes(flag)),
  }
}
