import pg from 'pg'

type Queryable = { query: (...args: unknown[]) => unknown }

const textOf = (call: readonly unknown[]): string => {
  const first = call[0]
  if (typeof first === 'string') return first
  const text = (first as { text?: unknown } | undefined)?.text
  return typeof text === 'string' ? text : ''
}

/**
 * Counts every statement the shared pool issues, including the ones a transaction runs on its
 * checked-out client (which a `pool.query` spy never sees). `pg`'s Pool forwards to
 * `client.query`, so patching the client prototype sees both paths.
 */
export function countQueries(): { statements: string[]; stop: () => string[] } {
  const prototype = pg.Client.prototype as unknown as Queryable
  const original = prototype.query
  const statements: string[] = []
  prototype.query = function (this: unknown, ...args: unknown[]) {
    statements.push(textOf(args))
    return Reflect.apply(original, this, args)
  }
  return {
    statements,
    stop: () => {
      prototype.query = original
      return statements
    },
  }
}
