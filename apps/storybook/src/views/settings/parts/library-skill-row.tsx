import { Badge } from "@dltech/atlas-ui/components/badge";
import { Switch } from "@dltech/atlas-ui/components/switch";

import { ESkillSource, type LibrarySkill } from "../../../fixtures/settings-library";
import { SettingsRow } from "../settings-layout";
import { LibraryRowMenu, type LibraryMenuAction } from "./library-row-menu";

const SOURCE_VARIANT = {
  [ESkillSource.User]: "secondary",
  [ESkillSource.Project]: "outline",
  [ESkillSource.BuiltIn]: "ghost",
} as const;

export function SkillRow({
  skill,
  actions,
  onToggle,
}: {
  skill: LibrarySkill;
  actions?: LibraryMenuAction[];
  onToggle?: (enabled: boolean) => void;
}) {
  return (
    <SettingsRow
      title={
        <>
          <span className="font-mono text-xs">{skill.name}</span>
          <Badge variant={SOURCE_VARIANT[skill.source]}>{skill.source}</Badge>
        </>
      }
      description={skill.description}
      control={
        <>
          {onToggle ? (
            <Switch
              aria-label={`Enable ${skill.name}`}
              checked={skill.enabled}
              onCheckedChange={onToggle}
            />
          ) : null}
          {actions ? <LibraryRowMenu label={skill.name} actions={actions} /> : null}
        </>
      }
    />
  );
}
