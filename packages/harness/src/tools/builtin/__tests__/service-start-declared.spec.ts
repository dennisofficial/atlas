import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { open } from '../../../services/__tests__/declared-fixture'
import { ServiceStartTool } from '../service-start'

const start = async (input: object): Promise<{ outcome: ToolOutcome; started: number }> => {
  const { registry, processes, root } = open()
  const tool = new ServiceStartTool(registry, processes)
  const outcome: ToolOutcome = await tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: root,
    threadId: toThreadId('t'),
  } as never)
  const started = processes.servicesStarted().length
  await registry.closeAll()
  return { outcome, started }
}

describe('service_start and declared names', () => {
  it('runs the declaration when a declared name comes without a command', async () => {
    const { outcome, started } = await start({ description: 'x', name: 'web' })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.modelText).toContain('web')
    expect(outcome.ok && outcome.modelText).toContain('ready')
    expect(started).toBe(1)
  })

  it.each([{ command: 'serve' }, { workdir: '/tmp' }, { port: 24000 }, { exposePort: 24000 }])(
    'refuses a declared name given %o, starting nothing',
    async (extra) => {
      const { outcome, started } = await start({ description: 'x', name: 'web', ...extra })

      expect(outcome.ok).toBe(false)
      expect(!outcome.ok && outcome.reason).toContain('runs from its declaration')
      expect(started).toBe(0)
    },
  )

  it('refuses an undeclared name without a command', async () => {
    const { outcome, started } = await start({ description: 'x', name: 'scratch' })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('needs a command')
    expect(!outcome.ok && outcome.reason).toContain('web')
    expect(started).toBe(0)
  })

  it('refuses a nameless call without a command', async () => {
    const { outcome } = await start({ description: 'x' })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('needs a command')
  })

  it('starts an undeclared name with a command ad hoc', async () => {
    const { outcome, started } = await start({
      description: 'x',
      name: 'scratch',
      command: 'sleep 30',
    })

    expect(outcome.ok).toBe(true)
    expect(started).toBe(1)
  })
})
