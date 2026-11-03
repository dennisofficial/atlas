import { describe, expect, it } from 'bun:test'

import { featureForTool } from '../feature-tools'

describe('featureForTool', () => {
  it('maps the feature-bearing tools', () => {
    expect(featureForTool('enter_worktree')).toBe('worktree-enter')
    expect(featureForTool('exit_worktree')).toBe('worktree-exit')
    expect(featureForTool('execution_location')).toBe('container-move')
    expect(featureForTool('skill')).toBe('skill-load')
  })

  it('leaves high-frequency tools uncounted', () => {
    expect(featureForTool('bash')).toBeUndefined()
    expect(featureForTool('read')).toBeUndefined()
    expect(featureForTool('edit')).toBeUndefined()
    expect(featureForTool('grep')).toBeUndefined()
  })
})
