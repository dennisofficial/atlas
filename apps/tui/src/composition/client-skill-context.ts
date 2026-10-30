import { ECapability, supports } from '@dltech/atlas-wire'
import { skillContextOf } from '@dltech/atlas-harness'
import type { EventDraft } from '@dltech/atlas-core'

import type { AtlasApp } from './compose'
import { cloudChannelOf } from './thread-view-refresh'

export function withLocalSkillContext(args: {
  app: AtlasApp
  text: string
  context: readonly EventDraft[]
}): readonly EventDraft[] {
  const { app, text, context } = args
  return [
    ...context,
    ...skillContextOf({ text, skills: app.skillRegistry.all(), already: context }),
  ]
}

export function withOldServeSkillContext(args: {
  app: AtlasApp
  text: string
  context: readonly EventDraft[]
}): readonly EventDraft[] {
  const channel = cloudChannelOf(args.app)
  if (channel === null) return args.context
  if (supports({ capabilities: channel.capabilities(), capability: ECapability.CommandList })) {
    return args.context
  }
  return withLocalSkillContext(args)
}
