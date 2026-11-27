const THOUSAND = 1_000
const MILLION = 1_000_000
const TENTH_OF_MILLION = 100_000

export const contextWindowLabel = (tokens: number): string =>
  tokens >= MILLION
    ? `${Math.round(tokens / TENTH_OF_MILLION) / 10}M`
    : `${Math.round(tokens / THOUSAND)}k`
