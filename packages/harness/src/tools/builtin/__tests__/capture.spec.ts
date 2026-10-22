import {
  EQualitySkipReason,
  toThreadId,
  AgentFileSystemPort,
  type CapturedFileChange,
  type QualityCoverageDiagnostic,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'

import { LocalFileSystemPort } from '../../../execution/local-filesystem'
import { EditTool } from '../edit'
import { MultiEditTool } from '../multi-edit'
import { WriteTool } from '../write'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-capture-'))
})

type CapturedOutcome = {
  fileChanges: readonly CapturedFileChange[]
  fileChangeFaults: readonly QualityCoverageDiagnostic[]
}

function capturedOf(outcome: ToolOutcome): CapturedOutcome {
  if (!outcome.ok) throw new Error(`expected success: ${outcome.reason}`)
  return {
    fileChanges: outcome.fileChanges ?? [],
    fileChangeFaults: outcome.fileChangeFaults ?? [],
  }
}

function changesOf(outcome: ToolOutcome): readonly CapturedFileChange[] {
  return capturedOf(outcome).fileChanges
}

function faultsOf(outcome: ToolOutcome): readonly QualityCoverageDiagnostic[] {
  return capturedOf(outcome).fileChangeFaults
}

const invoke = (
  tool: WriteTool | EditTool | MultiEditTool,
  input: unknown,
  captureFileChanges?: boolean,
): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'capture',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
    ...(captureFileChanges === undefined ? {} : { captureFileChanges }),
  })

const seeded = async (args: { name: string; text: string | Buffer }): Promise<string> => {
  const path = join(root, args.name)
  await writeFile(path, args.text)
  return path
}

class UnreadableBefore extends LocalFileSystemPort {
  override async readTextForEdit(_args: { path: string; threadId?: ThreadId | undefined }): Promise<never> {
    throw new Error('simulated backend read failure')
  }
}

class ReadTracker extends LocalFileSystemPort {
  reads: string[] = []
  override async readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    this.reads.push(`readFile:${args.path}`)
    return await super.readFile(args)
  }
  override async readTextForEdit(args: { path: string; threadId?: ThreadId | undefined }) {
    this.reads.push(`readTextForEdit:${args.path}`)
    return await super.readTextForEdit(args)
  }
}

describe('write capture', () => {
  it('attaches before:null on creation', async () => {
    const outcome = await invoke(new WriteTool(), { path: 'fresh.ts', content: 'const a = 1\n' }, true)
    expect(changesOf(outcome)).toEqual([{ path: join(root, 'fresh.ts'), before: null, after: 'const a = 1\n' }])
    expect(faultsOf(outcome)).toEqual([])
  })

  it('attaches exact before/after on overwrite', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const outcome = await invoke(new WriteTool(), { path, content: 'const a = 2\n' }, true)
    expect(changesOf(outcome)).toEqual([{ path, before: 'const a = 1\n', after: 'const a = 2\n' }])
  })

  it('captures before:"" for an existing empty file, distinct from creation', async () => {
    const path = await seeded({ name: 'empty.ts', text: '' })
    const outcome = await invoke(new WriteTool(), { path, content: 'x\n' }, true)
    expect(changesOf(outcome)).toEqual([{ path, before: '', after: 'x\n' }])
  })

  it('capture fault never blocks the overwrite on invalid UTF-8', async () => {
    const path = await seeded({ name: 'binary.ts', text: Buffer.from([0xff, 0xfe, 0x61]) })
    const outcome = await invoke(new WriteTool(), { path, content: 'replaced\n' }, true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(await readFile(path, 'utf8')).toBe('replaced\n')
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome).map((fault) => fault.reason)).toEqual([EQualitySkipReason.InvalidText])
  })

  it('advisory before-read failure preserves write success with SourceUnavailable', async () => {
    const path = await seeded({ name: 'a.ts', text: 'old\n' })
    const outcome = await invoke(new WriteTool(undefined, new UnreadableBefore()), { path, content: 'new\n' }, true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(await readFile(path, 'utf8')).toBe('new\n')
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome).map((fault) => fault.reason)).toEqual([EQualitySkipReason.SourceUnavailable])
  })

  it('emits no change for an identical overwrite with capture on', async () => {
    const path = await seeded({ name: 'same.ts', text: 'const a = 1\n' })
    const outcome = await invoke(new WriteTool(), { path, content: 'const a = 1\n' }, true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome)).toEqual([])
    expect(await readFile(path, 'utf8')).toBe('const a = 1\n')
  })

  it('does not read the file before writing when capture is off', async () => {
    const files = new ReadTracker()
    const path = await seeded({ name: 'a.ts', text: 'old\n' })
    const outcome = await invoke(new WriteTool(undefined, files), { path, content: 'new\n' })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(files.reads).toEqual([])
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome)).toEqual([])
  })
})

describe('edit capture', () => {
  it('attaches exact before/after on a successful replace', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\nconst b = 2\n' })
    const outcome = await invoke(new EditTool(), { path, oldString: 'const a = 1', newString: 'const a = 10' }, true)
    expect(changesOf(outcome)).toEqual([
      { path, before: 'const a = 1\nconst b = 2\n', after: 'const a = 10\nconst b = 2\n' },
    ])
    expect(faultsOf(outcome)).toEqual([])
  })

  it('captures replaceAll as one aggregate change', async () => {
    const path = await seeded({ name: 'dup.ts', text: 'foo\nbar\nfoo\n' })
    const outcome = await invoke(new EditTool(), { path, oldString: 'foo', newString: 'baz', replaceAll: true }, true)
    expect(changesOf(outcome)).toEqual([{ path, before: 'foo\nbar\nfoo\n', after: 'baz\nbar\nbaz\n' }])
  })

  it('captures empty-oldString creation with before:null', async () => {
    const path = join(root, 'created.ts')
    const outcome = await invoke(new EditTool(), { path, oldString: '', newString: 'const a = 1\n' }, true)
    expect(changesOf(outcome)).toEqual([{ path, before: null, after: 'const a = 1\n' }])
  })

  it('emits no capture on a failed replacement', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const outcome = await invoke(new EditTool(), { path, oldString: 'nope', newString: 'x' }, true)
    expect(outcome.ok).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('const a = 1\n')
  })

  it('emits no capture when oldString and newString are identical', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const outcome = await invoke(new EditTool(), { path, oldString: 'const a = 1', newString: 'const a = 1' }, true)
    expect(outcome.ok).toBe(false)
  })

  it('emits an InvalidText fault on invalid UTF-8 and still edits identically to capture off', async () => {
    const bytes = Buffer.concat([Buffer.from('const a = 1\n'), Buffer.from([0xff, 0x61]), Buffer.from('\n')])
    const path = await seeded({ name: 'odd.ts', text: bytes })

    const on = await invoke(new EditTool(), { path, oldString: 'const a = 1', newString: 'const a = 2' }, true)
    if (!on.ok) throw new Error(on.reason)
    const onDisk = await readFile(path)
    expect(faultsOf(on).map((fault) => fault.reason)).toEqual([EQualitySkipReason.InvalidText])
    expect(changesOf(on)).toEqual([])

    await writeFile(path, bytes)
    const off = await invoke(new EditTool(), { path, oldString: 'const a = 1', newString: 'const a = 2' })
    if (!off.ok) throw new Error(off.reason)
    const offDisk = await readFile(path)
    expect(onDisk.equals(offDisk)).toBe(true)
  })

  it('preserves CRLF and unicode in captured before/after', async () => {
    const path = await seeded({ name: 'dos.ts', text: 'const a = "é"\r\nconst b = 2\r\n' })
    const outcome = await invoke(new EditTool(), { path, oldString: '2', newString: '"ü"' }, true)
    const changes = changesOf(outcome)
    expect(changes[0]?.before).toBe('const a = "é"\r\nconst b = 2\r\n')
    expect(changes[0]?.after).toBe('const a = "é"\r\nconst b = "ü"\r\n')
  })

  it('keeps a BOM byte-identical with capture on and off (local backend keeps BOM)', async () => {
    const path = await seeded({ name: 'bom.ts', text: '﻿const a = 1\n' })
    const on = await invoke(new EditTool(), { path, oldString: 'const a = 1', newString: 'const a = 2' }, true)
    if (!on.ok) throw new Error(on.reason)
    expect(faultsOf(on)).toEqual([])
    expect(changesOf(on)[0]?.before).toBe('﻿const a = 1\n')
    const onDisk = await readFile(path)

    const off = await invoke(new EditTool(), { path, oldString: 'const a = 2', newString: 'const a = 3' })
    if (!off.ok) throw new Error(off.reason)
    const offDisk = await readFile(path)
    expect(onDisk.toString('utf8')).toBe('﻿const a = 2\n')
    expect(offDisk.toString('utf8')).toBe('﻿const a = 3\n')
  })

  it('skips the before-read entirely for a source file whose size is past the capture bound', async () => {
    const files = new ReadTracker()
    const path = await seeded({ name: 'big.ts', text: `const a = "${'x'.repeat(1024 * 1024 + 1)}"\n` })
    const outcome = await invoke(new WriteTool(undefined, files), { path, content: 'small\n' }, true)
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(files.reads).toEqual([])
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome).map((fault) => fault.reason)).toEqual([EQualitySkipReason.OversizedSource])
    expect(await readFile(path, 'utf8')).toBe('small\n')
  })

  it('uses one backend readTextForEdit when capture is on, readFile when off', async () => {
    const files = new ReadTracker()
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const on = await invoke(new EditTool(undefined, files), { path, oldString: '1', newString: '2' }, true)
    if (!on.ok) throw new Error(on.reason)
    expect(files.reads).toEqual([`readTextForEdit:${path}`])

    files.reads = []
    const off = await invoke(new EditTool(undefined, files), { path, oldString: '2', newString: '3' })
    if (!off.ok) throw new Error(off.reason)
    expect(files.reads).toEqual([`readFile:${path}`])
  })
})

describe('multi_edit capture', () => {
  it('emits one aggregate raw-before/final-after change after all edits', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\nconst b = 2\nconst c = 3\n' })
    const outcome = await invoke(
      new MultiEditTool(),
      {
        path,
        edits: [
          { oldString: 'const a = 1', newString: 'const a = 10' },
          { oldString: 'const c = 3', newString: 'const c = 30' },
        ],
      },
      true,
    )
    expect(changesOf(outcome)).toEqual([
      {
        path,
        before: 'const a = 1\nconst b = 2\nconst c = 3\n',
        after: 'const a = 10\nconst b = 2\nconst c = 30\n',
      },
    ])
  })

  it('emits no capture when the nth edit fails', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const outcome = await invoke(
      new MultiEditTool(),
      { path, edits: [{ oldString: '1', newString: '2' }, { oldString: 'missing', newString: 'x' }] },
      true,
    )
    expect(outcome.ok).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('const a = 1\n')
  })

  it('emits no capture metadata when capture is off', async () => {
    const path = await seeded({ name: 'a.ts', text: 'const a = 1\n' })
    const outcome = await invoke(new MultiEditTool(), { path, edits: [{ oldString: '1', newString: '2' }] })
    if (!outcome.ok) throw new Error(outcome.reason)
    expect(changesOf(outcome)).toEqual([])
    expect(faultsOf(outcome)).toEqual([])
  })
})

describe('adjacent locked writes', () => {
  it('each serialized write observes the adjacent before state', async () => {
    const tool = new WriteTool()
    const path = join(root, 'chain.ts')
    await invoke(tool, { path, content: 'one\n' }, true)
    const second = await invoke(tool, { path, content: 'two\n' }, true)
    const third = await invoke(tool, { path, content: 'three\n' }, true)
    expect(changesOf(second)).toEqual([{ path, before: 'one\n', after: 'two\n' }])
    expect(changesOf(third)).toEqual([{ path, before: 'two\n', after: 'three\n' }])
  })
})
