import { describe, expect, it } from 'bun:test'

import { EShellBar, shellBarOf } from '../shell-bar'

describe('shellBarOf', () => {
  it('uses the thread header on thread routes', () => {
    expect(shellBarOf('/threads/thr_1')).toBe(EShellBar.Thread)
    expect(shellBarOf('/threads/thr_1/')).toBe(EShellBar.Thread)
  })

  it('uses the global mobile bar everywhere else', () => {
    expect(shellBarOf('/threads')).toBe(EShellBar.Global)
    expect(shellBarOf('/threads/new')).toBe(EShellBar.Global)
    expect(shellBarOf('/projects')).toBe(EShellBar.Global)
    expect(shellBarOf('/projects/p1/settings')).toBe(EShellBar.Global)
  })
})
