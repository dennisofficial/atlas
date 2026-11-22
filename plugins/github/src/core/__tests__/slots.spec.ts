import { describe, expect, it } from 'bun:test'

import { githubControl } from '../../control'
import { githubCoreSlots } from '..'

describe('github plugin slots', () => {
  it('declares no views and no commands', () => {
    expect(githubCoreSlots.commands).toEqual([])
    expect(githubCoreSlots.views).toEqual([])
  })

  it('keeps the tracking target hook and no subscription row writer', () => {
    expect(githubControl.hooks.map((hook) => hook.name)).toEqual(['github-tracking-targets'])
  })
})
