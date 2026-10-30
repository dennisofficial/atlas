import { describe, expect, it } from 'bun:test'

import { fileMountNoticeOf } from '../file-mount-notice'
import { EFileMountState } from '../file-mounts'

describe('fileMountNoticeOf', () => {
  it('returns a clean message when every file was written plainly', () => {
    const notice = fileMountNoticeOf({
      outcomes: [{ path: '.env', state: EFileMountState.Written }],
    })
    expect(notice).toContain('Atlas wrote the project files: .env.')
    expect(notice).toContain('Files settings.')
  })

  it('stays silent with no outcomes', () => {
    expect(fileMountNoticeOf({ outcomes: [] })).toBeNull()
  })

  it('warns about files written but not excluded', () => {
    const notice = fileMountNoticeOf({
      outcomes: [{ path: 'a.env', state: EFileMountState.WrittenNotExcluded, reason: 'nope' }],
    })
    expect(notice).toContain('could not add them to .git/info/exclude')
    expect(notice).toContain('a.env — nope.')
  })

  it('lists excluded, tracked and unwritable paths and always closes with the reminder', () => {
    const notice = fileMountNoticeOf({
      outcomes: [
        { path: 'a.env', state: EFileMountState.WrittenLocallyExcluded },
        { path: 'b.env', state: EFileMountState.SkippedTracked },
        { path: 'c.env', state: EFileMountState.Failed, reason: 'boom' },
        { path: 'd.env', state: EFileMountState.SkippedNoRepository },
      ],
    })
    expect(notice).toContain('which git does not ignore: a.env.')
    expect(notice).toContain('because git tracks them: b.env.')
    expect(notice).toContain('could not write these project files: c.env — boom; d.env.')
    expect(notice).toContain('Files settings.')
  })
})
