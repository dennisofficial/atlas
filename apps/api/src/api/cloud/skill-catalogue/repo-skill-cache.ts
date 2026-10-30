import type { SkillCatalogueEntry } from '@dltech/atlas-wire'

const DEFAULT_CAPACITY = 200

export class RepoSkillCache {
  private readonly held = new Map<string, readonly SkillCatalogueEntry[]>()

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  get(key: string): readonly SkillCatalogueEntry[] | undefined {
    const found = this.held.get(key)
    if (found === undefined) return undefined
    this.held.delete(key)
    this.held.set(key, found)
    return found
  }

  set(args: { key: string; skills: readonly SkillCatalogueEntry[] }): void {
    this.held.delete(args.key)
    this.held.set(args.key, args.skills)
    const oldest = this.held.keys().next().value
    if (this.held.size > this.capacity && oldest !== undefined) this.held.delete(oldest)
  }
}
