import type { AccountId } from '@dltech/atlas-core'

const accounts = new WeakMap<object, AccountId>()

const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

export function withFailureAccount(args: { error: unknown; accountId: AccountId }): unknown {
  if (isObject(args.error) && !accounts.has(args.error)) accounts.set(args.error, args.accountId)
  return args.error
}

export async function failingAs<TResult>(args: {
  accountId: AccountId
  run: () => PromiseLike<TResult>
}): Promise<TResult> {
  try {
    return await args.run()
  } catch (error) {
    throw withFailureAccount({ error, accountId: args.accountId })
  }
}

const MAX_DEPTH = 8

export function failureAccountOf(error: unknown): AccountId | undefined {
  let current: unknown = error
  for (let depth = 0; depth < MAX_DEPTH && isObject(current); depth += 1) {
    const found = accounts.get(current)
    if (found !== undefined) return found
    const next = current as { cause?: unknown; lastError?: unknown }
    current = next.cause ?? next.lastError
  }
  return undefined
}
