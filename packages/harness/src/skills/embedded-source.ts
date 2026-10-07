import { basename, dirname, extname } from 'node:path'

import { atlasDirectory } from '../store/paths'
import { materializeSkillBundle } from './bundle-materializer'
import type { EmbeddedSkillEntry } from './embedded-bundle'
import { BUILT_IN_SKILLS } from './manifest.generated'
import {
  ESkillOrigin,
  isSkillEntryFilename,
  parseSkill,
  SkillSource,
  type DiscoveredSkill,
} from './skill'

const nameOf = (path: string): string => {
  const file = basename(path)
  if (isSkillEntryFilename(file)) return basename(dirname(path))
  return basename(file, extname(file))
}

export type EmbeddedSkillFailure = { name: string; message: string }

const warnOnConsole = (failure: EmbeddedSkillFailure): void => {
  console.warn(`built-in skill ${failure.name} is unavailable: ${failure.message}`)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class EmbeddedSkillSource extends SkillSource {
  readonly origin = ESkillOrigin.BuiltIn
  private readonly home: string | undefined
  private readonly entries: readonly EmbeddedSkillEntry[]
  private readonly onFailure: (failure: EmbeddedSkillFailure) => void

  constructor(
    args: {
      home?: string | undefined
      entries?: readonly EmbeddedSkillEntry[] | undefined
      onFailure?: ((failure: EmbeddedSkillFailure) => void) | undefined
    } = {},
  ) {
    super()
    this.home = args.home
    this.entries = args.entries ?? BUILT_IN_SKILLS
    this.onFailure = args.onFailure ?? warnOnConsole
  }

  async load(): Promise<readonly DiscoveredSkill[]> {
    const loaded = await Promise.all(this.entries.map((entry) => this.isolated(entry)))
    return loaded.flatMap((skill) => (skill === undefined ? [] : [skill]))
  }

  private async isolated(entry: EmbeddedSkillEntry): Promise<DiscoveredSkill | undefined> {
    try {
      return await this.skillOf(entry)
    } catch (error) {
      this.report({ name: nameOf(entry.path), message: messageOf(error) })
      return undefined
    }
  }

  private report(failure: EmbeddedSkillFailure): void {
    try {
      this.onFailure(failure)
    } catch {
      warnOnConsole(failure)
    }
  }

  private async skillOf(entry: EmbeddedSkillEntry): Promise<DiscoveredSkill | undefined> {
    const fallbackName = nameOf(entry.path)
    if (entry.bundle === undefined) {
      return parseSkill({ text: entry.text, fallbackName, origin: this.origin })
    }

    const materialized = await materializeSkillBundle({
      home: this.home ?? atlasDirectory(),
      name: fallbackName,
      entry,
    })
    return parseSkill({
      text: entry.text,
      fallbackName,
      origin: this.origin,
      directory: materialized.directory,
      entryPath: materialized.entryPath,
    })
  }
}
