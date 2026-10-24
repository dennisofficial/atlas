import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EMemoryScope, EMemoryType, MEMORY_STALE_REVISION_CODE } from '@dltech/atlas-wire/web'

import { CloudApiError } from '@/lib/cloud-api'

import { answerTrpc, resetTrpc, restoreTrpc, trpcFailure } from '@/lib/__tests__/fake-trpc'
import { errorMessageOf } from '../error-message'
import { putMemory, type MemoryDraft } from '../memory-api'

beforeEach(resetTrpc)
afterEach(restoreTrpc)

const CHANGED_ELSEWHERE = 'This changed elsewhere. Reload the page and try again.'

const draft: MemoryDraft = {
  scope: EMemoryScope.Global,
  project: null,
  name: 'n',
  description: 'd',
  type: EMemoryType.Reference,
  body: 'b',
}

const failureOfEdit = async (): Promise<unknown> =>
  putMemory(draft).then(
    () => undefined,
    (failure: unknown) => failure,
  )

describe('memory refusals through the tRPC envelope', () => {
  it('maps a 409 stale revision to the changed-elsewhere text and keeps its code', async () => {
    answerTrpc(() =>
      trpcFailure({
        status: 409,
        rpcCode: -32009,
        name: 'CONFLICT',
        path: 'memories.put',
        message: 'memory is at revision 2, not 1; read it again',
        detailsCode: MEMORY_STALE_REVISION_CODE,
      }),
    )
    const failure = await failureOfEdit()
    expect(failure).toBeInstanceOf(CloudApiError)
    expect(failure).toMatchObject({ status: 409, code: MEMORY_STALE_REVISION_CODE })
    expect(errorMessageOf(failure)).toBe(CHANGED_ELSEWHERE)
  })

  it.each([
    ['memory-edit-no-match', 'old text was not found in the memory'],
    ['memory-edit-ambiguous', 'old text matches more than once; add context'],
  ])('keeps the details message for a 422 %s', async (detailsCode, message) => {
    answerTrpc(() =>
      trpcFailure({
        status: 422,
        rpcCode: -32022,
        name: 'UNPROCESSABLE_CONTENT',
        path: 'memories.put',
        message,
        detailsCode,
      }),
    )
    const failure = await failureOfEdit()
    expect(failure).toMatchObject({ status: 422, code: detailsCode })
    expect(errorMessageOf(failure)).toBe(message)
    expect(errorMessageOf(failure)).not.toBe(CHANGED_ELSEWHERE)
  })
})
