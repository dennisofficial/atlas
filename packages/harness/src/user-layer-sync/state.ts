import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { writeFileAtomically } from '../files/atomic-write'

export type SyncedEntry = { revision: number; contentHash: string }

const stateFileSchema = z.object({
  deviceId: z.string().min(1),
  trees: z.record(
    z.string(),
    z.record(z.string(), z.object({ revision: z.number(), contentHash: z.string() })),
  ),
})

export class UserLayerState {
  private dirty = false

  private constructor(
    private readonly file: string,
    readonly deviceId: string,
    private readonly trees: Map<string, Map<string, SyncedEntry>>,
  ) {}

  static async load(args: { file: string }): Promise<UserLayerState> {
    try {
      const parsed = stateFileSchema.parse(JSON.parse(await readFile(args.file, 'utf8')))
      const trees = new Map(
        Object.entries(parsed.trees).map(([tree, entries]) => [
          tree,
          new Map(Object.entries(entries)),
        ]),
      )
      return new UserLayerState(args.file, parsed.deviceId, trees)
    } catch {
      const fresh = new UserLayerState(args.file, randomUUID(), new Map())
      fresh.dirty = true
      await fresh.save()
      return fresh
    }
  }

  get(args: { tree: string; path: string }): SyncedEntry | undefined {
    return this.trees.get(args.tree)?.get(args.path)
  }

  entries(args: { tree: string }): readonly (readonly [string, SyncedEntry])[] {
    return [...(this.trees.get(args.tree)?.entries() ?? [])]
  }

  set(args: { tree: string; path: string; revision: number; contentHash: string }): void {
    const entries = this.trees.get(args.tree) ?? new Map<string, SyncedEntry>()
    entries.set(args.path, { revision: args.revision, contentHash: args.contentHash })
    this.trees.set(args.tree, entries)
    this.dirty = true
  }

  remove(args: { tree: string; path: string }): void {
    if (this.trees.get(args.tree)?.delete(args.path) === true) this.dirty = true
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    const trees = Object.fromEntries(
      [...this.trees].map(([tree, entries]) => [tree, Object.fromEntries(entries)]),
    )
    await writeFileAtomically({
      path: this.file,
      content: JSON.stringify({ deviceId: this.deviceId, trees }, null, 2),
    })
    this.dirty = false
  }
}
