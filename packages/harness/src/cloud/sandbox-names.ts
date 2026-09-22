import { createHash } from 'node:crypto'

const SANDBOX_NAME_PREFIX = 'atlas-thread'
const DIGEST_LENGTH = 24

const digestOf = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH)

/**
 * The same name apps/api's `sandbox-names.ts` derives for the row, duplicated rather than shared —
 * apps/api carries no in-repo dependency by design, and both sides must agree because the row and
 * the Vercel sandbox meet by name.
 */
export function sandboxNameFor(args: { threadId: string }): string {
  return `${SANDBOX_NAME_PREFIX}-${digestOf(args.threadId)}`
}
