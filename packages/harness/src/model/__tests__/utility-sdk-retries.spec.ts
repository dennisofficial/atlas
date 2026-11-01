import { APICallError } from '@ai-sdk/provider'
import {
  DEFAULT_CLASSIFIER_POLICY,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'

import { critiqueConfiguration } from '../../classifier/critique'
import { carryOverSummariser } from '../../rotation/carry-over-summary'
import { summaryFor } from '../summariser'
import { titleFor } from '../titler'
import { tldrFor } from '../tldr'

const rateLimited = (): APICallError =>
  new APICallError({
    message: 'slow down',
    url: 'https://provider.test',
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: true,
  })

const failing = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw rateLimited()
    },
    doStream: async () => {
      throw rateLimited()
    },
  })

const EVENTS = stampDrafts({
  drafts: [{ type: 'user-said', text: 'rotate the token' }],
  envelopes: [
    {
      id: toEventId('evt-1'),
      seq: 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: '2026-10-31T00:00:00.000Z',
    },
  ],
})

describe('utility SDK calls leave retrying to the policy', () => {
  it('makes one request when the titler is rate limited', async () => {
    const model = failing()

    expect(await titleFor({ model, text: 'fix the build' })).toBeNull()
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('makes one request when the tl;dr is rate limited', async () => {
    const model = failing()

    await tldrFor({ model, events: EVENTS, anchorSeq: 1, throughSeq: 1 })

    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('makes one request when the compaction summariser is rate limited', async () => {
    const model = failing()

    await summaryFor({ model, events: EVENTS, fromSeq: 1, throughSeq: 1 }).catch(() => undefined)

    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('makes one request when the rotation carry-over summary is rate limited', async () => {
    const model = failing()

    await carryOverSummariser({ model })({
      events: EVENTS,
      fromSeq: 1,
      throughSeq: 1,
      instructions: '',
      signal: new AbortController().signal,
    }).catch(() => undefined)

    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it('makes one request when the configuration critique is rate limited', async () => {
    const model = failing()

    await critiqueConfiguration({ model, policy: DEFAULT_CLASSIFIER_POLICY })

    expect(model.doGenerateCalls).toHaveLength(1)
  })
})
