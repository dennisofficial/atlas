import { Badge } from '@dltech/atlas-ui/components/badge'

import { ESkillLayer, SKILL_LAYER_LABELS } from '../fixtures/settings-skills'

export function SkillLayerBadge({ layer }: { layer: ESkillLayer }) {
  const variant =
    layer === ESkillLayer.BuiltIn || layer === ESkillLayer.Repo ? 'outline' : 'secondary'
  return <Badge variant={variant}>{SKILL_LAYER_LABELS[layer]}</Badge>
}
