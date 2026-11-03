export const STARTING_PLACEHOLDER = 'The sandbox is starting — you can keep typing…'
export const SUMMARISING_PLACEHOLDER =
  'Summarising — what you send now waits until the summary is written…'

export function composerPlaceholderOf(args: {
  summarising: boolean
  starting: boolean
  idle: string | undefined
}): string | undefined {
  if (args.summarising) return SUMMARISING_PLACEHOLDER
  if (args.starting) return STARTING_PLACEHOLDER
  return args.idle
}
