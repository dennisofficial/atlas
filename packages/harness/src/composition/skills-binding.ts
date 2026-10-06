import { ENoticeTone, NOTICE_WARN_MS, skillRootPlan, type NoticePort } from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../container/injection'
import { EmbeddedSkillSource, type EmbeddedSkillFailure } from '../skills/embedded-source'
import { LiveSkillRegistry } from '../skills/live-registry'
import { SkillRegistryPort } from '../skills/port'
import { resolveSkillRoots, skillSourcesFor } from '../skills/roots'

const SKILLS_DIRECTORY_NAME = 'skills'

export class SkillRegistryNotBound extends Error {
  constructor() {
    super(
      'the skill registry binding did not take, so the embedded-only registry the container ships with is still in place',
    )
  }
}

export function bindSkillRegistry(args: {
  container: DependencyContainer
  registry: SkillRegistryPort
}): SkillRegistryPort {
  const token = portToken(SkillRegistryPort)
  args.container.register(token, { useValue: args.registry })

  if (!args.container.isRegistered(token, true)) throw new SkillRegistryNotBound()

  const resolved = args.container.resolve(token)
  if (resolved !== args.registry) throw new SkillRegistryNotBound()

  return resolved
}

const bundledSkillWarning =
  (notice: NoticePort) =>
  (failure: EmbeddedSkillFailure): void => {
    notice.notify({
      key: `bundled-skill:${failure.name}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `bundled skill unavailable: ${failure.name} — ${failure.message}`,
    })
  }

export async function liveSkillRegistry(args: {
  atlasHome: string
  home: string
  cwd: string
  notice?: NoticePort | undefined
}): Promise<SkillRegistryPort> {
  const onFailure = args.notice === undefined ? undefined : bundledSkillWarning(args.notice)
  const registry = new LiveSkillRegistry({
    sources: async () => {
      const roots = await resolveSkillRoots({
        plan: skillRootPlan({
          atlasHome: args.atlasHome,
          home: args.home,
          cwd: args.cwd,
          skillsDirectoryName: SKILLS_DIRECTORY_NAME,
        }),
      })

      return [
        new EmbeddedSkillSource({ home: args.atlasHome, onFailure }),
        ...skillSourcesFor({ roots }),
      ]
    },
  })

  await registry.reload()
  return registry
}
