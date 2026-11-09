import { describe, expect, it } from 'bun:test'

import { composedPlugins } from '../registered-plugins'

describe('the agent host plugin composition', () => {
  it('registers crew beside the other native plugins', () => {
    expect(composedPlugins.names).toContain('crew')
  })

  it('keeps memory and spawn tools away from a sub-agent', () => {
    expect(composedPlugins.pod.childDeny).toContain('write_memory')
    expect(composedPlugins.pod.childDeny).toContain('read_memory')
    expect(composedPlugins.pod.childDeny).toContain('agent_spawn')
    expect(composedPlugins.pod.childDeny).not.toContain('report_to_main')
  })
})
