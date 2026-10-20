export const PUSH_COMMAND = 'push'

const YES_FLAGS: readonly string[] = ['--yes', '-y']
const HELP_FLAGS: readonly string[] = ['--help', '-h']

export type PushRequest = { yes: boolean; help: boolean; unknown: readonly string[] }

export function pushRequestOf({ argv }: { argv: readonly string[] }): PushRequest | undefined {
  if (argv[0] !== PUSH_COMMAND) return undefined

  const flags = argv.slice(1)
  return {
    yes: flags.some((flag) => YES_FLAGS.includes(flag)),
    help: flags.some((flag) => HELP_FLAGS.includes(flag)),
    unknown: flags.filter((flag) => !YES_FLAGS.includes(flag) && !HELP_FLAGS.includes(flag)),
  }
}
