import type { CommandEntry } from './entry'
import { slashNameOf } from './mention'
import type { CommandRegistry } from './registry'
import { EClientAction, ECommandRunsIn } from './spec'
import { EInvocation, parseInvocation } from './text'

const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

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

export const clientActionOfEntries = ({
  text,
  entries,
}: {
  text: string
  entries: readonly CommandEntry[]
}): EClientAction | null => {
  const line = firstLineOf(text)
  const found = slashNameOf({ text: line })
  if (found === null) return null
  if (line.slice(found.end).trim() !== '') return null
  return entries.find((entry) => entry.name === found.name)?.opens ?? null
}
