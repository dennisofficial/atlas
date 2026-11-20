import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { ESkillOrigin } from '../../core'
import { type FakeNode, fakeCloud, fakeDaemon, turn } from './support'

type Nodes = Record<string, FakeNode>

const emptyRepo = (): Nodes => ({
  '/repo': { kind: 'dir' },
  '/repo/.atlas': { kind: 'dir' },
  '/repo/.agents': { kind: 'dir' },
  '/repo/.agents/skills': { kind: 'dir' },
})

const addSkill = (args: { nodes: Nodes; name: string; description: string }): void => {
  const root = '/repo/.agents/skills'
  args.nodes[`${root}/${args.name}`] = { kind: 'dir' }
  args.nodes[`${root}/${args.name}/SKILL.md`] = {
    kind: 'file',
    text: `---\nname: ${args.name}\ndescription: ${args.description}\n---\n\nbody\n`,
  }
}

const gate = () => {
  let release: () => void = () => undefined
  let held: Promise<void> | null = null
  return {
    close: (): void => {
      held = new Promise<void>((settle) => {
        release = settle
      })
    },
    open: (): void => {
      release()
      held = null
    },
    held: (): Promise<void> | null => held,
  }
}

const rig = (nodes: Nodes) => {
  const daemon = fakeDaemon(nodes)
  const underlying = daemon.ctx.call
  const held = gate()
  const appended: unknown[] = []
  const ctx: PluginPodContext = {
    ...daemon.ctx,
    append: async (drafts) => void appended.push(...drafts),
    call: async (op: CallOp): Promise<CallResult> => {
      const pending = held.held()
      if (pending !== null && op.op === 'readFile') await pending
      return await underlying(op)
    },
  }
  const cloud = fakeCloud({ entries: [] })
  return { daemon, ctx, cloud, appended, nodes, held }
}

const settle = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('the skill index never settled')
}

const races = async (args: { run: () => Promise<unknown>; ms: number }): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('waited'), args.ms)
  })
  try {
    return await Promise.race([args.run().then(() => 'returned'), late])
  } finally {
    clearTimeout(timer)
  }
}

const namesOf = (draft: unknown): readonly string[] =>
  ((draft as { skills: readonly { name: string; origin: ESkillOrigin }[] }).skills ?? [])
    .filter((row) => row.origin === ESkillOrigin.Repo)
    .map((row) => row.name)

describe('a turn after the first', () => {
  it('does no files work and publishes nothing when the repository has not changed', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    addSkill({ nodes, name: 'alpha', description: 'does alpha' })

    await turn({ ctx, cloud })
    expect(appended).toHaveLength(1)
    const reads = daemon.calls.length

    await turn({ ctx, cloud })
    expect(daemon.calls.length).toBe(reads)
    expect(appended).toHaveLength(1)
  })

  it('serves the last good index while the watcher re-reads, then picks the change up', async () => {
    const { daemon, ctx, cloud, appended, nodes, held } = rig(emptyRepo())
    addSkill({ nodes, name: 'alpha', description: 'does alpha' })
    await turn({ ctx, cloud })
    expect(namesOf(appended[0])).toEqual(['alpha'])

    held.close()
    addSkill({ nodes, name: 'beta', description: 'does beta' })
    daemon.emit({
      type: 'watch.changed',
      watchId: 'skills:s1',
      paths: ['/repo/.agents/skills/beta/SKILL.md'],
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const blocks = await races({ run: () => turn({ ctx, cloud }), ms: 100 }).then(
      async (outcome) => {
        expect(outcome).toBe('returned')
        return await turn({ ctx, cloud })
      },
    )
    expect(blocks.join('\n')).toContain('alpha: does alpha')
    expect(blocks.join('\n')).not.toContain('beta')
    expect(appended).toHaveLength(1)

    held.open()
    await settle(() => appended.length === 2)
    expect(namesOf(appended[1])).toEqual(['alpha', 'beta'])

    const next = await turn({ ctx, cloud })
    expect(next.join('\n')).toContain('beta: does beta')
  })
})
