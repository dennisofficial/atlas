import { describe, expect, it } from 'bun:test'
import { EOperatorInputOutcome, toThreadId, type EventDraft, type EventLogPort } from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { RandomIds } from '../../store/ids'
import type { DeliverOperatorInputArgs } from '../deliver'
import type { OperatorInputAnswerOutcome, OperatorInputRequestArgs } from '../port'
import { InProcessOperatorInput, OPERATOR_INPUT_CANCELLED } from '../registry'

const THREAD = toThreadId('thread-operator-input')
const VALUE = '  first\n第二行\n  '
const request = (overrides: Partial<OperatorInputRequestArgs> = {}): OperatorInputRequestArgs => ({
  threadId: THREAD, requestId: 'req-1', description: 'paste the code', path: '/tmp/code',
  cwd: '/tmp', appendNewline: false, signal: new AbortController().signal, ...overrides,
})

function fixture(deliver?: (args: DeliverOperatorInputArgs) => Promise<OperatorInputAnswerOutcome>) {
  const drafts: EventDraft[] = []
  const sent: DeliverOperatorInputArgs[] = []
  const log: EventLogPort = {
    append: async (args) => { drafts.push(...args.drafts); return [] },
    read: async () => [], readOwn: async () => [], head: async () => 0,
    refresh: async () => undefined, replace: async () => [],
  }
  const channel = createDeltaChannel()
  const registry = new InProcessOperatorInput({
    log, ids: new RandomIds(), channel: () => channel,
    deliver: async (args) => {
      sent.push(args)
      return deliver === undefined ? { ok: true, bytes: Buffer.byteLength(args.value) } : await deliver(args)
    },
  })
  return { registry, channel, log, sent, drafts }
}

describe('operator input lifecycle', () => {
  it('delivers exact multiline text and logs no value', async () => {
    const { registry, channel, sent, drafts } = fixture()
    const waiting = registry.request(request())
    const answered = await registry.answer({ requestId: 'req-1', value: VALUE })
    expect(answered).toEqual({ ok: true, bytes: Buffer.byteLength(VALUE) })
    expect(await waiting).toEqual(answered)
    expect(sent[0]?.value).toBe(VALUE)
    expect(registry.pending({ threadId: THREAD })).toBeNull()
    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
    expect(drafts).toHaveLength(2)
    expect(drafts[1]).toMatchObject({ type: 'operator-input-resolved', outcome: EOperatorInputOutcome.Delivered })
    expect(JSON.stringify(drafts)).not.toContain('第二行')
  })

  it('does not acknowledge delivery until the writer completes', async () => {
    let finish: ((value: OperatorInputAnswerOutcome) => void) | undefined
    const writing = new Promise<OperatorInputAnswerOutcome>((resolve) => { finish = resolve })
    const { registry } = fixture(() => writing)
    const waiting = registry.request(request())
    const answered = registry.answer({ requestId: 'req-1', value: VALUE })
    await Promise.resolve()
    expect(registry.pending({ threadId: THREAD })?.requestId).toBe('req-1')
    finish?.({ ok: true, bytes: Buffer.byteLength(VALUE) })
    expect(await answered).toEqual(await waiting)
  })

  it('adds only an explicitly requested missing final newline', async () => {
    const { registry, sent } = fixture()
    const first = registry.request(request({ appendNewline: true }))
    await registry.answer({ requestId: 'req-1', value: VALUE })
    await first
    expect(sent[0]?.value).toBe(`${VALUE}\n`)
    const second = registry.request(request({ appendNewline: true, requestId: 'req-2' }))
    await registry.answer({ requestId: 'req-2', value: 'code\n' })
    await second
    expect(sent[1]?.value).toBe('code\n')
  })

  it('refuses concurrent, foreign, duplicate and stale answers', async () => {
    const { registry, sent } = fixture()
    const waiting = registry.request(request())
    expect((await registry.request(request({ requestId: 'req-2' }))).ok).toBe(false)
    expect((await registry.answer({ requestId: 'req-1', value: VALUE, threadId: toThreadId('foreign') })).ok).toBe(false)
    const first = registry.answer({ requestId: 'req-1', value: VALUE })
    const duplicate = registry.answer({ requestId: 'req-1', value: VALUE })
    expect((await first).ok).toBe(true)
    expect((await duplicate).ok).toBe(false)
    await waiting
    expect((await registry.answer({ requestId: 'req-1', value: VALUE })).ok).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('cancels and clears a request even when aborted before publication', async () => {
    const { registry, drafts } = fixture()
    const controller = new AbortController()
    const waiting = registry.request(request({ signal: controller.signal }))
    controller.abort()
    expect(await waiting).toEqual({ ok: false, reason: OPERATOR_INPUT_CANCELLED })
    expect(registry.pending({ threadId: THREAD })).toBeNull()
    expect(drafts.at(-1)).toMatchObject({ outcome: EOperatorInputOutcome.Cancelled })
  })

  it('does not let a deferred abort settle underneath a writer started while publication was pending', async () => {
    let releaseAppend: (() => void) | undefined
    let releaseDelivery: (() => void) | undefined
    const appending = new Promise<void>((resolve) => { releaseAppend = resolve })
    const delivering = new Promise<void>((resolve) => { releaseDelivery = resolve })
    const { registry, log } = fixture(async () => {
      await delivering
      return { ok: false, reason: OPERATOR_INPUT_CANCELLED }
    })
    let firstAppend = true
    log.append = async () => {
      if (firstAppend) { firstAppend = false; await appending }
      return []
    }
    const controller = new AbortController()
    const waiting = registry.request(request({ signal: controller.signal }))
    const answer = registry.answer({ requestId: 'req-1', value: VALUE })
    controller.abort()
    releaseAppend?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(registry.pending({ threadId: THREAD })?.requestId).toBe('req-1')
    releaseDelivery?.()
    expect(await answer).toEqual({ ok: false, reason: OPERATOR_INPUT_CANCELLED })
    expect(await waiting).toEqual({ ok: false, reason: OPERATOR_INPUT_CANCELLED })
  })

  it('records actual delivery failure and settles the tool without claiming success', async () => {
    const { registry, drafts } = fixture(async () => ({ ok: false, reason: 'no reader' }))
    const waiting = registry.request(request())
    expect(await registry.answer({ requestId: 'req-1', value: VALUE })).toEqual({ ok: false, reason: 'no reader' })
    expect(await waiting).toEqual({ ok: false, reason: 'no reader' })
    expect(drafts.at(-1)).toMatchObject({ outcome: EOperatorInputOutcome.Undelivered })
  })

  it('settles rather than hanging when recording the request fails', async () => {
    const { registry, log } = fixture()
    log.append = async () => { throw new Error('disk full') }
    expect(await registry.request(request())).toMatchObject({ ok: false })
    expect(registry.pending({ threadId: THREAD })).toBeNull()
  })

  it('replays a value-free pending request to subscribers mounted later', async () => {
    const { registry, channel } = fixture()
    const waiting = registry.request(request())
    await Promise.resolve()
    const seen: unknown[] = []
    const off = channel.subscribe({ threadId: THREAD, listener: (signal) => seen.push(signal) })
    expect(seen).toContainEqual({ type: 'operator-input', request: registry.pending({ threadId: THREAD }) })
    off()
    await registry.answer({ requestId: 'req-1', value: VALUE })
    await waiting
  })
})
