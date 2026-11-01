const SECONDS = 1_000
const DELTA_SECONDS = /^\d+(?:\.\d+)?$/
const HTTP_DATE = /^[A-Za-z]{3,9},?\s/

const headerOf = (args: {
  headers: Readonly<Record<string, string>> | undefined
  name: string
}): string | undefined => {
  if (args.headers === undefined) return undefined
  const found = Object.keys(args.headers).find((key) => key.toLowerCase() === args.name)
  return found === undefined ? undefined : args.headers[found]?.trim()
}

const instantOf = (ms: number): string | undefined => {
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export function retryAtOf(args: {
  headers: Readonly<Record<string, string>> | undefined
  nowMs: number
}): string | undefined {
  const value = headerOf({ headers: args.headers, name: 'retry-after' })
  if (value === undefined || value === '') return undefined

  if (DELTA_SECONDS.test(value)) return instantOf(args.nowMs + Number(value) * SECONDS)
  if (!HTTP_DATE.test(value)) return undefined

  const notBefore = Date.parse(value)
  return Number.isFinite(notBefore) ? instantOf(notBefore) : undefined
}
