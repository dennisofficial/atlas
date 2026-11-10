import { describe, expect, it } from 'bun:test'

import type {
  CloudSkillEntry,
  CloudSkillSource,
  CloudSkillWriteResult,
  CloudSkillWriter,
} from '../port'
import { fakeCloud, fakeDaemon, invoke, skillDir, textOf, turn } from './support'

type Stored = {
  scope: 'user' | 'project'
  name: string
  description: string
  body: string
  revision: number
}

const keyOf = (scope: string, name: string): string => `${scope}:${name}`

const cloudStore = () => {
  const rows = new Map<string, Stored>()

  const source: CloudSkillSource = {
    entries: (): readonly CloudSkillEntry[] =>
      [...rows.values()].map((row) => ({
        name: row.name,
        description: row.description,
        scope: row.scope,
      })),
    frontmatter: async () =>
      [...rows.values()].map((row) => ({ scope: row.scope, name: row.name, text: row.body })),
    body: async (entry) => {
      const row = rows.get(keyOf(entry.scope, entry.name))
      return row === undefined
        ? null
        : { text: row.body, revision: row.revision, hash: `h-${row.name}` }
    },
    file: async () => null,
  }

  const writes: CloudSkillWriter = {
    write: async (request): Promise<CloudSkillWriteResult> => {
      const key = keyOf(request.scope, request.name)
      const existing = rows.get(key)
      const base = request.baseRevision ?? -1
      if (existing === undefined) {
        if (base !== 0) return { ok: false, reason: 'no such skill', current: null }
        rows.set(key, {
          scope: request.scope,
          name: request.name,
          description: request.description ?? '',
          body: request.body,
          revision: 1,
        })
        return { ok: true, revision: 1 }
      }
      if (existing.revision !== base)
        return {
          ok: false,
          reason: `the ${request.name} skill changed since baseRevision ${base}`,
          current: { revision: existing.revision, hash: `h-${request.name}` },
        }
      rows.set(key, {
        ...existing,
        description: request.description ?? existing.description,
        body: request.body,
        revision: existing.revision + 1,
      })
      return { ok: true, revision: existing.revision + 1 }
    },
    remove: async (request) =>
      rows.delete(keyOf(request.scope, request.name))
        ? { ok: true, revision: 0 }
        : {
            ok: false,
            reason: `no ${request.scope} skill is named ${request.name}`,
            current: null,
          },
  }

  return { rows, source, writes }
}

describe('skill_install, skill_edit and skill_delete in the cloud', () => {
  it('installs a skill and the next turn lists it with the description its frontmatter carries', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })

    const installed = await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_install',
      input: {
        layer: 'project',
        name: 'gamma',
        body: skillDir('gamma', 'body of gamma'),
      },
    })
    expect(textOf(installed)).toContain('installed in the cloud project layer at revision 1')
    expect(store.rows.get('project:gamma')?.description).toBe('does gamma')

    const listing = await turn({ ctx, cloud: store.source, writes: store.writes })
    expect(listing.join('\n')).toContain('gamma: does gamma')
  })

  it('refuses an edit whose baseRevision is stale and names the revision and hash to retry with', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })
    await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_install',
      input: { layer: 'user', name: 'gamma', body: skillDir('gamma', 'one') },
    })

    const edited = await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_edit',
      input: { name: 'gamma', layer: 'user', body: skillDir('gamma', 'two'), baseRevision: 1 },
    })
    expect(edited.ok).toBe(true)
    expect(textOf(edited)).toContain('now at revision 2')

    const stale = await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_edit',
      input: { name: 'gamma', layer: 'user', body: skillDir('gamma', 'three'), baseRevision: 1 },
    })
    expect(stale.ok).toBe(false)
    expect(textOf(stale)).toContain('changed since baseRevision 1')
    expect(textOf(stale)).toContain('revision 2 with hash h-gamma')
  })

  it('refuses an edit that carries no baseRevision', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })
    await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_install',
      input: { layer: 'user', name: 'gamma', body: skillDir('gamma', 'one') },
    })

    const outcome = await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_edit',
      input: { name: 'gamma', layer: 'user', body: skillDir('gamma', 'two') },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('revision 1 with hash h-gamma')
  })

  it('deletes a skill and the next turn no longer lists it', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })
    await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_install',
      input: { layer: 'user', name: 'gamma', body: skillDir('gamma', 'one') },
    })

    const deleted = await invoke({
      ctx,
      cloud: store.source,
      writes: store.writes,
      name: 'skill_delete',
      input: { name: 'gamma', layer: 'user' },
    })
    expect(deleted.ok).toBe(true)

    const listing = await turn({ ctx, cloud: store.source, writes: store.writes })
    expect(listing.join('\n')).not.toContain('gamma')
  })

  it('refuses a built-in name on every cloud layer, and says why', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })
    for (const layer of ['user', 'project'] as const) {
      const outcome = await invoke({
        ctx,
        cloud: store.source,
        writes: store.writes,
        name: 'skill_delete',
        input: { name: 'commit', layer },
      })
      expect(outcome.ok).toBe(false)
      expect(textOf(outcome)).toContain('ships compiled into Atlas')
    }
    expect(store.rows.size).toBe(0)
  })

  it('refuses a cloud write when the session supplies no writer', async () => {
    const store = cloudStore()
    const { ctx } = fakeDaemon({ '/repo/.git': { kind: 'dir' } })
    const outcome = await invoke({
      ctx,
      cloud: store.source,
      name: 'skill_install',
      input: { layer: 'user', name: 'gamma', body: skillDir('gamma', 'one') },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('cannot write cloud skills')
  })
})
