import { createHash } from 'node:crypto'

const SANDBOX_NAME_PREFIX = 'atlas-thread'
const DIGEST_LENGTH = 24

const digestOf = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, DIGEST_LENGTH)

export function sandboxNameFor(args: { threadId: string }): string {
  return `${SANDBOX_NAME_PREFIX}-${digestOf(args.threadId)}`
}

const FACTORY_NAME_PREFIX = 'factory'

export function factorySandboxNameFor(args: { workItemId: string }): string {
  return `${FACTORY_NAME_PREFIX}-${args.workItemId.replaceAll('_', '-')}`
}

export function factoryStationSandboxNameFor(args: { runId: string }): string {
  return `${FACTORY_NAME_PREFIX}-st-${args.runId.replaceAll('_', '-')}`
}
