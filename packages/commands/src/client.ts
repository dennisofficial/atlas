import type { CommandRegistry } from './registry'
import { EClientAction, ECommandRunsIn } from './spec'
import { EInvocation, parseInvocation } from './text'

export const clientActionOf = ({
  text,
  commands,
}: {
  text: string
  commands: CommandRegistry
}): EClientAction | null => {
  const invocation = parseInvocation({ text, commands, skills: [] })
  if (invocation.kind !== EInvocation.Command) return null
  if (invocation.command.spec.runsIn !== ECommandRunsIn.Client) return null
  return invocation.command.spec.opens ?? null
}
