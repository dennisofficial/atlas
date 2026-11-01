import type { AccountId } from '@dltech/atlas-core'

import { attachProvenance, provenanceOf, type RequestProvenance } from '../model/failure-provenance'

export type FailureAttachment = RequestProvenance & { accountId: AccountId }

export function withFailureAccount(args: FailureAttachment & { error: unknown }): unknown {
  const { error, ...provenance } = args
  return attachProvenance({ error, provenance })
}

export async function failingAs<TResult>(
  args: FailureAttachment & { run: () => PromiseLike<TResult> },
): Promise<TResult> {
  const { run, ...provenance } = args
  try {
    return await run()
  } catch (error) {
    throw attachProvenance({ error, provenance })
  }
}

export const failureAccountOf = (error: unknown): AccountId | undefined =>
  provenanceOf(error)?.accountId
