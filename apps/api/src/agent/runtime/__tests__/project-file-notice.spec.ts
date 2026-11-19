import { describe, expect, it } from 'bun:test'

import { projectFileNoticeOf } from '../project-file-notice'
import { EProjectFileState } from '../project-files'

describe('projectFileNoticeOf', () => {
  it('names the files it wrote', () => {
    const notice = projectFileNoticeOf([
      { path: 'apps/api/.env.keys', state: EProjectFileState.Written },
      { path: '~/notes.md', state: EProjectFileState.Written },
    ])

    expect(notice).toContain('Atlas wrote the project files: apps/api/.env.keys, ~/notes.md.')
    expect(notice).toContain('every sandbox start')
  })

  it('has nothing to say about no mounts', () => {
    expect(projectFileNoticeOf([])).toBeNull()
  })

  it('tells the model a tracked file was left alone', () => {
    const notice = projectFileNoticeOf([
      { path: 'README.md', state: EProjectFileState.SkippedTracked },
    ])

    expect(notice).toContain('because git tracks them: README.md')
  })

  it('carries the reason a file could not be written', () => {
    const notice = projectFileNoticeOf([
      { path: 'a.txt', state: EProjectFileState.Failed, reason: 'the path leaves its folder' },
    ])

    expect(notice).toContain(
      'Atlas could not write these project files: a.txt — the path leaves its folder.',
    )
  })

  it('warns about files git shows as untracked', () => {
    const notice = projectFileNoticeOf([
      { path: '.env.keys', state: EProjectFileState.WrittenNotExcluded, reason: 'git failed' },
    ])

    expect(notice).toContain('could not add them to .git/info/exclude')
    expect(notice).toContain('.env.keys — git failed')
  })
})
