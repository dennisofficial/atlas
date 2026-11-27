export type McpSignInAttempt = { readonly state: string; readonly label: string }

type HeldAttempt = McpSignInAttempt & { readonly shown: boolean }

const MAX_ATTEMPTS = 8

const attempts = new Map<string, HeldAttempt>()

export const rememberMcpSignIn = (attempt: McpSignInAttempt): void => {
  if (attempt.state === '') return
  attempts.delete(attempt.state)
  attempts.set(attempt.state, { ...attempt, shown: false })
  while (attempts.size > MAX_ATTEMPTS) {
    const oldest = attempts.keys().next()
    if (oldest.done === true) return
    attempts.delete(oldest.value)
  }
}

export const mcpSignInsAwaitingResult = (): readonly McpSignInAttempt[] =>
  [...attempts.values()]
    .filter((attempt) => !attempt.shown)
    .map((attempt) => ({ state: attempt.state, label: attempt.label }))

export const markMcpSignInShown = (state: string): void => {
  const held = attempts.get(state)
  if (held !== undefined) attempts.set(state, { ...held, shown: true })
}
