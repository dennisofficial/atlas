import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { EMemoryScope, EMemoryType, type MemoryEntry, type MemorySummary } from '@dltech/atlas-wire'

import {
  MemoryEditRefused,
  MemoryPort,
  MemoryUnavailable,
  type MemoryAddress,
} from '../../../memory/memory-port'
import { DeleteMemoryTool } from '../memory-delete'
import { EditMemoryTool } from '../memory-edit'
import { ReadMemoryTool } from '../memory-read'
import { WriteMemoryTool } from '../memory-write'

const summaryOf = (args: MemoryAddress & { revision: number }): MemorySummary => ({
  scope: args.scope,
  project: args.scope === EMemoryScope.Project ? 'org/repo' : null,
  name: args.name,
  description: 'd',
  type: EMemoryType.Reference,
  revision: args.revision,
  updatedAt: '2026-10-20T00:00:00.000Z',
})

class FakeMemoryPort extends MemoryPort {
  readonly project: string | null
  readonly rows = new Map<string, MemoryEntry>()
  failure: Error | null = null

  constructor(project: string | null = 'org/repo') {
    super()
    this.project = project
  }

  private key(address: MemoryAddress): string {
    return `${address.scope}:${address.name}`
  }

  private guard(address?: MemoryAddress): void {
    if (this.failure !== null) throw this.failure
    if (address?.scope === EMemoryScope.Project && this.project === null) {
      throw new MemoryUnavailable(
        'this session has no GitHub repository, so only global memory is available',
      )
    }
  }

  async list(): Promise<readonly MemorySummary[]> {
    return [...this.rows.values()]
  }

  async read(args: MemoryAddress): Promise<MemoryEntry | null> {
    this.guard(args)
    return this.rows.get(this.key(args)) ?? null
  }

  async write(
    args: MemoryAddress & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary> {
    this.guard(args)
    const revision = (this.rows.get(this.key(args))?.revision ?? 0) + 1
    const entry = {
      ...summaryOf({ ...args, revision }),
      description: args.description,
      type: args.type,
      body: args.body,
    }
    this.rows.set(this.key(args), entry)
    return entry
  }

  async edit(
    args: MemoryAddress & { old: string; new: string; revision: number },
  ): Promise<MemorySummary> {
    this.guard(args)
    const row = this.rows.get(this.key(args))
    if (row === undefined) throw new MemoryEditRefused({ message: 'missing' })
    if (row.revision !== args.revision) {
      throw new MemoryEditRefused({
        code: 'memory-stale-revision',
        message: `stale: current revision is ${row.revision}`,
      })
    }
    const next = { ...row, body: row.body.replace(args.old, args.new), revision: row.revision + 1 }
    this.rows.set(this.key(args), next)
    return next
  }

  async delete(args: MemoryAddress): Promise<boolean> {
    this.guard(args)
    return this.rows.delete(this.key(args))
  }
}

const invoke = (args: {
  tool: { invoke: (invocation: never) => Promise<ToolOutcome> }
  input: unknown
}) =>
  args.tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/repo',
    threadId: toThreadId('thr_1'),
  } as never)

const modelTextOf = (outcome: ToolOutcome): string => {
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.modelText
}

const WRITE = {
  scope: 'global',
  name: 'bun-deflate',
  description: 'raw not zlib',
  type: 'reference',
  body: 'Fact.\n\n**Why:** x\n\n**How to apply:** y',
}

describe('write_memory', () => {
  it('remembers and reports the revision', async () => {
    const port = new FakeMemoryPort()
    const outcome = await invoke({ tool: new WriteMemoryTool(port), input: WRITE })

    expect(modelTextOf(outcome)).toBe('Remembered bun-deflate (global, revision 1).')
    const again = await invoke({ tool: new WriteMemoryTool(port), input: WRITE })
    expect(modelTextOf(again)).toBe('Remembered bun-deflate (global, revision 2).')
  })

  it('rejects a name that is not a hyphenated slug', async () => {
    const outcome = await invoke({
      tool: new WriteMemoryTool(new FakeMemoryPort()),
      input: { ...WRITE, name: 'Bad Name' },
    })

    expect(outcome.ok).toBe(false)
  })

  it('rejects an unknown field', async () => {
    const outcome = await invoke({
      tool: new WriteMemoryTool(new FakeMemoryPort()),
      input: { ...WRITE, extra: 1 },
    })

    expect(outcome.ok).toBe(false)
  })

  it('refuses a project memory when the session has no GitHub repository', async () => {
    const outcome = await invoke({
      tool: new WriteMemoryTool(new FakeMemoryPort(null)),
      input: { ...WRITE, scope: 'project' },
    })

    expect(outcome).toEqual({
      ok: false,
      reason: 'this session has no GitHub repository, so only global memory is available',
    })
  })

  it('refuses rather than throws when signed out', async () => {
    const port = new FakeMemoryPort()
    port.failure = new MemoryUnavailable('sign in to Atlas Cloud to use memory')

    expect(await invoke({ tool: new WriteMemoryTool(port), input: WRITE })).toEqual({
      ok: false,
      reason: 'sign in to Atlas Cloud to use memory',
    })
  })
})

describe('read_memory', () => {
  it('returns the body with its revision', async () => {
    const port = new FakeMemoryPort()
    await invoke({ tool: new WriteMemoryTool(port), input: WRITE })

    const text = modelTextOf(
      await invoke({
        tool: new ReadMemoryTool(port),
        input: { scope: 'global', name: 'bun-deflate' },
      }),
    )

    expect(text).toContain('revision 1')
    expect(text).toContain('**Why:** x')
  })

  it('says a missing memory is missing', async () => {
    const outcome = await invoke({
      tool: new ReadMemoryTool(new FakeMemoryPort()),
      input: { scope: 'global', name: 'nope' },
    })

    expect(outcome).toEqual({ ok: false, reason: 'there is no global memory "nope"' })
  })

  it('refuses a project read with no project', async () => {
    const outcome = await invoke({
      tool: new ReadMemoryTool(new FakeMemoryPort(null)),
      input: { scope: 'project', name: 'x' },
    })

    expect(outcome.ok).toBe(false)
  })
})

describe('edit_memory', () => {
  const EDIT = {
    scope: 'global',
    name: 'bun-deflate',
    old: 'Fact.',
    new: 'Better fact.',
    revision: 1,
  }

  it('applies against the revision read', async () => {
    const port = new FakeMemoryPort()
    await invoke({ tool: new WriteMemoryTool(port), input: WRITE })

    expect(modelTextOf(await invoke({ tool: new EditMemoryTool(port), input: EDIT }))).toBe(
      'Edited bun-deflate (global, revision 2).',
    )
  })

  it('returns the stale-revision reason instead of throwing', async () => {
    const port = new FakeMemoryPort()
    await invoke({ tool: new WriteMemoryTool(port), input: WRITE })
    await invoke({ tool: new WriteMemoryTool(port), input: WRITE })

    expect(await invoke({ tool: new EditMemoryTool(port), input: EDIT })).toEqual({
      ok: false,
      reason: 'stale: current revision is 2',
    })
  })
})

describe('delete_memory', () => {
  it('forgets an existing memory and reports a missing one', async () => {
    const port = new FakeMemoryPort()
    await invoke({ tool: new WriteMemoryTool(port), input: WRITE })
    const input = { scope: 'global', name: 'bun-deflate' }

    expect(modelTextOf(await invoke({ tool: new DeleteMemoryTool(port), input }))).toBe(
      'Forgot bun-deflate (global).',
    )
    expect(await invoke({ tool: new DeleteMemoryTool(port), input })).toEqual({
      ok: false,
      reason: 'there is no global memory "bun-deflate"',
    })
  })
})

describe('tool effects', () => {
  it('marks read as a read and the rest as writes', () => {
    const port = new FakeMemoryPort()

    expect(
      [
        new ReadMemoryTool(port),
        new WriteMemoryTool(port),
        new EditMemoryTool(port),
        new DeleteMemoryTool(port),
      ].map((tool) => [tool.name, tool.effect]),
    ).toEqual([
      ['read_memory', 'read'],
      ['write_memory', 'write'],
      ['edit_memory', 'write'],
      ['delete_memory', 'write'],
    ])
  })
})
