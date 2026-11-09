import { describe, expect, it } from 'bun:test'

import { crewPod } from '..'
import { rig } from './worktree-rig'

describe('the worktree tools', () => {
  it('ships beside the five crew tools and tracks its own events', () => {
    const { ctx } = rig()
    expect(crewPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'agent_spawn',
      'agent_say',
      'agent_stop',
      'agent_list',
      'report_to_main',
      'enter_worktree',
      'exit_worktree',
      'worktree_list',
    ])
    expect(crewPod.hooks?.(ctx).afterTool?.map((hook) => hook.name)).toEqual([
      'crew-worktree-track',
    ])
  })
})
