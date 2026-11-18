import { EFileChange } from '@dltech/atlas-ui/ai/changes-panel'
import { EChangeFileStatus, type ChangedFile } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import {
  binaryLabel,
  byteSizeLabel,
  changeOfStatus,
  changedFilesOf,
  renameLabel,
  rowsOf,
  workingTreeFileOf,
} from '../rows'

const entry = (overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'src/app.ts',
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 4,
  deletions: 2,
  binary: false,
  size: 120,
  baseHash: 'base-hash',
  currentHash: 'current-hash',
  ...overrides,
})

describe('changeOfStatus', () => {
  it('maps every status to a change mark', () => {
    expect(changeOfStatus(EChangeFileStatus.Added)).toBe(EFileChange.Added)
    expect(changeOfStatus(EChangeFileStatus.Modified)).toBe(EFileChange.Modified)
    expect(changeOfStatus(EChangeFileStatus.Deleted)).toBe(EFileChange.Deleted)
  })
})

describe('changedFilesOf', () => {
  it('maps a row without a diff and adds lines once one is cached', () => {
    const files = [entry()]
    expect(changedFilesOf({ files, diffs: new Map() })).toEqual([
      { path: 'src/app.ts', added: 4, removed: 2, change: EFileChange.Modified },
    ])
    const lines = [{ kind: 'add', text: 'x', newNumber: 1 }] as const
    expect(
      changedFilesOf({ files, diffs: new Map([['src/app.ts', { lines: [...lines] }]]) })[0]?.lines,
    ).toEqual([...lines])
  })

  it('carries the counts and mark of the entry', () => {
    expect(rowsOf(entry({ status: EChangeFileStatus.Added }))).toEqual({
      path: 'src/app.ts',
      added: 4,
      removed: 2,
      change: EFileChange.Added,
    })
  })
})

describe('renameLabel', () => {
  it('names both paths of a rename', () => {
    expect(renameLabel(workingTreeFileOf(entry({ oldPath: 'src/old.ts' })))).toBe(
      'src/old.ts → src/app.ts',
    )
  })

  it('says nothing for a file that did not move', () => {
    expect(renameLabel(workingTreeFileOf(entry()))).toBeNull()
    expect(renameLabel(workingTreeFileOf(entry({ oldPath: 'src/app.ts' })))).toBeNull()
  })
})

describe('binaryLabel', () => {
  it('sizes a binary file', () => {
    expect(binaryLabel(workingTreeFileOf(entry({ binary: true, size: 12_700 })))).toBe(
      'Binary file — 12.4 KB',
    )
  })

  it('names a binary file without a size', () => {
    expect(binaryLabel(workingTreeFileOf(entry({ binary: true, size: null })))).toBe('Binary file')
  })

  it('sizes bytes and megabytes', () => {
    expect(byteSizeLabel(512)).toBe('512 B')
    expect(byteSizeLabel(3_145_728)).toBe('3.0 MB')
  })
})
