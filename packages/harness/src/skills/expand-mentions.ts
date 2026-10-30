import {
  EContextSlot,
  expandSkillBody,
  resolveSubmission,
  type EventDraft,
} from '@dltech/atlas-core'

import type { DiscoveredSkill } from './skill'

const loadedSkillKeys = (drafts: readonly EventDraft[]): ReadonlySet<string> =>
  new Set(
    drafts.flatMap((draft) =>
      draft.type === 'context-loaded' && draft.slot === EContextSlot.Skill ? [draft.key] : [],
    ),
  )

export function skillContextOf(args: {
  text: string
  skills: readonly DiscoveredSkill[]
  already: readonly EventDraft[]
}): EventDraft[] {
  const invocable = args.skills.filter((skill) => skill.userInvocable)
  const submission = resolveSubmission({
    text: args.text,
    specs: invocable.map((skill) => skill.spec),
  })
  const bodies = new Map(invocable.map((skill) => [skill.spec.name, skill.body]))
  const loaded = loadedSkillKeys(args.already)

  return submission.skills.flatMap((one): EventDraft[] => {
    const body = bodies.get(one.spec.name)
    if (body === undefined || loaded.has(one.spec.name)) return []
    return [
      {
        type: 'context-loaded',
        slot: EContextSlot.Skill,
        key: one.spec.name,
        content: expandSkillBody({ body, argumentText: one.argumentText }),
      },
    ]
  })
}
