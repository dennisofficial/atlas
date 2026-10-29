import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { toThreadId, type EventDraft, type EventLogPort } from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { LocalProcessPort } from '../../execution/local-process'
import { RandomIds } from '../../store/ids'
import { deliverOperatorInput, prepareOperatorInputDestination } from '../deliver'
import { InProcessOperatorInput } from '../registry'

const THREAD = toThreadId('operator-destination')
const VALUE = 'pasted-secret\n'

function recordingLog(drafts: EventDraft[]): EventLogPort {
  return {
    append: async (args) => {
      drafts.push(...args.drafts)
      return []
    },
    read: async () => [],
    readOwn: async () => [],
    head: async () => 0,
    refresh: async () => undefined,
    replace: async () => [],
  }
}

async function openedRequestPath(registry: InProcessOperatorInput): Promise<string | undefined> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const pending = registry.pending({ threadId: THREAD })
    if (pending !== null) return pending.path
    await Bun.sleep(5)
  }
  return undefined
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-opdest-'))
  const files = new LocalFileSystemPort()
  const processes = new LocalProcessPort()
  const drafts: EventDraft[] = []
  const channel = createDeltaChannel()
  const registry = new InProcessOperatorInput({
    log: recordingLog(drafts),
    ids: new RandomIds(),
    channel: () => channel,
    prepareDestination: (args) => prepareOperatorInputDestination({ ...args, processes }),
    deliver: (args) => deliverOperatorInput({ ...args, files, processes }),
  })
  const requestArgs = (path: string) => ({
    threadId: THREAD,
    requestId: 'req-dest',
    description: 'paste it',
    path,
    cwd: root,
    appendNewline: false,
    signal: new AbortController().signal,
  })
  return { root, registry, drafts, requestArgs, close: () => rm(root, { recursive: true }) }
}

describe('operator input destination directories', () => {
  it('delivers into a destination whose parent directories do not exist yet', async () => {
    const { root, registry, requestArgs, close } = await fixture()
    const path = join(root, 'scratch', 'nested', 'code.txt')
    try {
      const waiting = registry.request(requestArgs(path))
      expect(await openedRequestPath(registry)).toBe(path)
      const answered = await registry.answer({ requestId: 'req-dest', value: VALUE })
      expect(answered).toEqual({ ok: true, bytes: Buffer.byteLength(VALUE) })
      expect(await waiting).toEqual(answered)
      expect(await readFile(path, 'utf8')).toBe(VALUE)
      expect((await stat(join(root, 'scratch'))).mode & 0o777).toBe(0o700)
    } finally {
      await close()
    }
  })

  it('fails the tool call before asking the operator when the directory cannot be made', async () => {
    const { root, registry, drafts, requestArgs, close } = await fixture()
    await Bun.write(join(root, 'blocker'), 'a file, not a directory')
    try {
      const result = await registry.request(requestArgs(join(root, 'blocker', 'code.txt')))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain(join(root, 'blocker'))
      expect(registry.pending({ threadId: THREAD })).toBeNull()
      expect(drafts).toEqual([])
    } finally {
      await close()
    }
  })
})
