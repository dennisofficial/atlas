import { ECommandGroup, ECommandKind } from '@dltech/atlas-core'

import { ECommandEcho, ECommandTiming, RAN, type LocalCommand } from './local-command'

export const instructionsOfArgument = (argumentText: string): string | undefined => {
  const trimmed = argumentText.trim()
  return trimmed === '' ? undefined : trimmed
}

export const rotateCommand = (args: {
  onRotate: (instructions: string | undefined) => void
}): LocalCommand => ({
  name: 'rotate',
  kind: ECommandKind.Local,
  summary: 'hand this conversation to a fresh main thread, carrying a summary forward',
  argumentHint: '[instructions]',
  group: ECommandGroup.Context,
  timing: ECommandTiming.Settled,
  echo: ECommandEcho.Name,
  run: ({ argumentText }) => {
    args.onRotate(instructionsOfArgument(argumentText))
    return RAN
  },
})
