import type { AgentContext } from './agents-panel-types'

const THOUSAND = 1000
const MILLION = 1_000_000

export function compactTokens(tokens: number): string {
  if (tokens >= MILLION) return `${Number((tokens / MILLION).toFixed(1))}M`
  if (tokens >= THOUSAND) return `${Math.round(tokens / THOUSAND)}k`
  return String(tokens)
}

export function formatContext({ tokens, window }: AgentContext): string {
  return `${compactTokens(tokens)} / ${compactTokens(window)} tokens`
}
