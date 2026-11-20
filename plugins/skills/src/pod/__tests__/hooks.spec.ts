import { describe, expect, it } from 'bun:test'

import { HookChain } from '@dltech/atlas-agent'
import { toThreadId, type Assembled } from '@dltech/atlas-core'

import { SKILL_LISTING_HEADING } from '../listing'
import { skillsPodOf } from '..'
import { fakeCloud, fakeDaemon } from './support'

const tree = {
  '/repo/.agents/skills': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha/SKILL.md': {
    kind: 'file' as const,
    text: '---\nname: alpha\ndescription: does alpha\nwhen_to_use: alpha work\n---\n\nbody',
  },
}

const slowDaemon = () => {
  const daemon = fakeDaemon(tree)
  return {
    ...daemon,
    ctx: {
      ...daemon.ctx,
      call: async (op: Parameters<typeof daemon.ctx.call>[0]) => {
        await Bun.sleep(15)
        return daemon.ctx.call(op)
      },
    },
  }
}

const assembled: Assembled = { system: [], messages: [] }

const chainOf = (args: { ctx: ReturnType<typeof slowDaemon>['ctx'] }): HookChain => {
  const hooks = skillsPodOf({ cloud: fakeCloud({ entries: [] }) }).hooks?.(args.ctx)
  return new HookChain({
    beforeTurn: hooks?.beforeTurn,
    beforeStep: hooks?.beforeStep,
    budgetMs: 1,
  })
}

describe('the skills hooks and the hook time budget', () => {
  it('marks the catalogue and the listing as awaited', () => {
    const { ctx } = fakeDaemon(tree)
    const hooks = skillsPodOf({ cloud: fakeCloud({ entries: [] }) }).hooks?.(ctx)

    expect(hooks?.beforeTurn?.map((hook) => [hook.name, hook.awaited])).toEqual([
      ['skills-catalogue', true],
    ])
    expect(hooks?.beforeStep?.map((hook) => [hook.name, hook.awaited])).toEqual([
      ['skills-listing', true],
    ])
  })

  it('carries the listing into the first step past a budget the catalogue outlives', async () => {
    const { ctx } = slowDaemon()
    const chain = chainOf({ ctx })

    await chain.beforeTurn({ threadId: toThreadId('t1'), projectDirectory: '/repo' })
    const first = await chain.beforeStep({ assembled, trace: [] })

    const listing = first.system.find((block) => block.source === 'skills-listing')
    expect(listing?.text).toContain(SKILL_LISTING_HEADING)
    expect(listing?.text).toContain('alpha')
  })
})
