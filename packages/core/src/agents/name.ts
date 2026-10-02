const NAME_WORD_LIMIT = 3

/**
 * The short handle every surface shows for an agent. Derived from the intent rather than stored, so
 * a recovered agent, an old log, and a live spawn all name themselves identically without a schema
 * change. Three words, no ellipsis: the sidebar is already cell-limited, and a handle that trails
 * off reads like it was cut rather than named.
 */
export function agentDisplayName(args: { agentType: string; intent: string }): string {
  const single = args.intent.replace(/\s+/g, ' ').trim()
  if (single === '') return args.agentType

  return single.split(' ').slice(0, NAME_WORD_LIMIT).join(' ')
}
