import { instanceCachingFactory, registeredPortToken, type DependencyContainer } from '../container/injection'
import { EmbeddedSkillSource } from './embedded-source'
import { LiveSkillRegistry, type SkillSources } from './live-registry'
import { SkillRegistryPort } from './port'

const embeddedOnly: SkillSources = () => [new EmbeddedSkillSource()]

export function registerSkills(args: {
  container: DependencyContainer
  sources?: SkillSources | undefined
}): void {
  const sources = args.sources ?? embeddedOnly

  args.container.register(registeredPortToken(SkillRegistryPort), {
    useFactory: instanceCachingFactory(() => new LiveSkillRegistry({ sources })),
  })
}
