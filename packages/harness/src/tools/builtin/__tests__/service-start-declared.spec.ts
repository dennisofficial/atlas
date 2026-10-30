import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { open } from '../../../services/__tests__/declared-fixture'
import { ServiceStartTool } from '../service-start'

describe('service_start and declared names', () => {
  it('refuses a name declared in services.yaml', async () => {
    const { registry, processes, root } = open()
    const tool = new ServiceStartTool(registry, processes)

    const outcome: ToolOutcome = await tool.invoke({
      input: { description: 'x', command: 'serve', name: 'web' },
      signal: new AbortController().signal,
      idempotencyKey: 'k',
      projectDirectory: root,
      threadId: toThreadId('t'),
    } as never)

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('use services_ensure or service_restart')
    expect(processes.servicesStarted()).toHaveLength(0)
  })
})
