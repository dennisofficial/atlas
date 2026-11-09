export const SHELL_TAIL_CHARACTERS = 60_000

export type ShellTail = { text: string; at: number }

export const applyShellOutput = (args: {
  shells: Readonly<Record<string, ShellTail>>
  frame: { shellId: string; offset: number; text: string }
}): Readonly<Record<string, ShellTail>> => {
  const { frame } = args
  const kept = args.shells[frame.shellId]
  const at = kept?.at ?? 0
  const end = frame.offset + frame.text.length
  if (end <= at) return args.shells
  const fresh =
    frame.offset > at ? frame.text : (kept?.text ?? '') + frame.text.slice(at - frame.offset)
  return { ...args.shells, [frame.shellId]: { text: fresh.slice(-SHELL_TAIL_CHARACTERS), at: end } }
}

export const withoutEndedShells = (args: {
  shells: Readonly<Record<string, ShellTail>>
  events: readonly Record<string, unknown>[]
}): Readonly<Record<string, ShellTail>> => {
  const ended = args.events.flatMap((event) =>
    event['type'] === 'background-shell-ended' && typeof event['shellId'] === 'string'
      ? [event['shellId']]
      : [],
  )
  if (ended.length === 0) return args.shells
  const kept = { ...args.shells }
  for (const shellId of ended) delete kept[shellId]
  return kept
}
