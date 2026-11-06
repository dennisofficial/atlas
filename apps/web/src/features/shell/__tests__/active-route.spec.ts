import { describe, expect, it } from 'bun:test'

import { activeNavOf, activeSessionIdOf, activeThreadIdOf } from '../active-route'
import { EAppNav } from '../shell-types'

describe('activeThreadIdOf', () => {
  it('reads the thread id from a thread path', () => {
    expect(activeThreadIdOf('/threads/thr_1')).toBe('thr_1')
    expect(activeThreadIdOf('/threads/thr_1/')).toBe('thr_1')
    expect(activeThreadIdOf('/threads/a%20b')).toBe('a b')
  })

  it('is null for home, new thread, projects and nested paths', () => {
    expect(activeThreadIdOf('/threads')).toBeNull()
    expect(activeThreadIdOf('/threads/new')).toBeNull()
    expect(activeThreadIdOf('/projects')).toBeNull()
    expect(activeThreadIdOf('/threads/a/b')).toBeNull()
  })

  it('falls back to the raw segment when it is not decodable', () => {
    expect(activeThreadIdOf('/threads/%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('activeSessionIdOf', () => {
  it('reads the session id from a session path', () => {
    expect(activeSessionIdOf('/sessions/s_1')).toBe('s_1')
    expect(activeSessionIdOf('/sessions/a%20b/')).toBe('a b')
  })

  it('is null elsewhere', () => {
    expect(activeSessionIdOf('/sessions')).toBeNull()
    expect(activeSessionIdOf('/threads/s_1')).toBeNull()
    expect(activeSessionIdOf('/sessions/a/b')).toBeNull()
  })
})

describe('activeNavOf', () => {
  it('marks projects paths as Projects and everything else as Threads', () => {
    expect(activeNavOf('/projects')).toBe(EAppNav.Projects)
    expect(activeNavOf('/projects/p1/settings')).toBe(EAppNav.Projects)
    expect(activeNavOf('/threads')).toBe(EAppNav.Threads)
    expect(activeNavOf('/threads/new')).toBe(EAppNav.Threads)
    expect(activeNavOf('/projectsx')).toBe(EAppNav.Threads)
  })
})
