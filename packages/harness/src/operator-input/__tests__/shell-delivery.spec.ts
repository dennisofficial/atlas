import { describe, expect, it } from 'bun:test'
import { EOperatorInputOutcome, toThreadId, type EventDraft, type EventLogPort } from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import type { ShellInputOutcome } from '../../shells/background-shell'
import { RandomIds } from '../../store/ids'
import type { DeliverOperatorInputArgs } from '../deliver'
import type { OperatorInputRequestArgs } from '../port'
import { InProcessOperatorInput } from '../registry'

const THREAD = toThreadId('thread-shell-delivery')
const request = (overrides: Partial<OperatorInputRequestArgs> = {}): OperatorInputRequestArgs => ({
  threadId: THREAD, requestId: 'req-1', description: 'paste the code', path: 'shell:sh-1', shellId: 'sh-1',
  cwd: '/tmp', appendNewline: true, signal: new AbortController().signal, ...overrides,
})

function fixture(args: { writeShellInput?: (input: { threadId: typeof THREAD; shellId: string; text: string }) => Promise<ShellInputOutcome> } = {}) {
  const drafts: EventDraft[] = []
  const files: DeliverOperatorInputArgs[] = []
  const writes: { threadId: typeof THREAD; shellId: string; text: string }[] = []
  const log: EventLogPort = {
    append: async (input) => { drafts.push(...input.drafts); return [] },
    read: async () => [], readOwn: async () => [], head: async () => 0,
    refresh: async () => undefined, replace: async () => [],
  }
  const registry = new InProcessOperatorInput({
    log, ids: new RandomIds(), channel: () => createDeltaChannel(),
    deliver: async (input) => { files.push(input); return { ok: true, bytes: 0 } },
    writeShellInput: args.writeShellInput ?? (async (input) => { writes.push(input); return { ok: true } }),
  })
  return { registry, drafts, files, writes }
}

describe('operator input delivered to a shell', () => {
  it('writes the newline-terminated value to the shell stdin and never touches file delivery', async () => {
    const { registry, drafts, files, writes } = fixture()
    const waiting = registry.request(request())
    const answered = await registry.answer({ requestId: 'req-1', value: 'code-123' })
    expect(answered).toEqual({ ok: true, bytes: Buffer.byteLength('code-123\n') })
    expect(await waiting).toEqual(answered)
    expect(writes).toEqual([{ threadId: THREAD, shellId: 'sh-1', text: 'code-123\n' }])
    expect(files).toHaveLength(0)
    expect(drafts.at(-1)).toMatchObject({ type: 'operator-input-resolved', outcome: EOperatorInputOutcome.Delivered })
    expect(JSON.stringify(drafts)).not.toContain('code-123')
  })

  it('sends the value exactly when no newline is requested', async () => {
    const { registry, writes } = fixture()
    const waiting = registry.request(request({ appendNewline: false }))
    await registry.answer({ requestId: 'req-1', value: 'code' })
    await waiting
    expect(writes[0]?.text).toBe('code')
  })

  it('reports an ended or closed shell as undelivered', async () => {
    const { registry, drafts } = fixture({ writeShellInput: async () => ({ ok: false, reason: 'stdin is closed' }) })
    const waiting = registry.request(request())
    const answered = await registry.answer({ requestId: 'req-1', value: 'code' })
    expect(answered).toEqual({ ok: false, reason: 'delivery to shell sh-1 failed: stdin is closed' })
    expect(await waiting).toEqual(answered)
    expect(drafts.at(-1)).toMatchObject({ outcome: EOperatorInputOutcome.Undelivered })
  })

  it('refuses a shell request when no shell writer is wired', async () => {
    const registry = new InProcessOperatorInput({
      log: { append: async () => [] },
      ids: new RandomIds(), channel: () => undefined,
      deliver: async () => ({ ok: true, bytes: 0 }),
    })
    const waiting = registry.request(request())
    const answered = await registry.answer({ requestId: 'req-1', value: 'code' })
    expect(answered.ok).toBe(false)
    expect(await waiting).toEqual(answered)
  })
})
