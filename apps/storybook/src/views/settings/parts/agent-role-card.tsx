import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@dltech/atlas-ui/components/select";

import {
  AUTO_MODEL,
  EFFORT_STEPS,
  MODEL_GROUPS,
  ROLE_META,
  type EAgentRole,
  type EEffort,
  type RoleSetting,
} from "../../../fixtures/settings-agent";
import { SettingsCard, SettingsRow, SettingsSection } from "../settings-layout";
import { EffortSlider } from "./agent-effort-slider";

function buildModelItems(autoLabel: string) {
  const items = [{ value: AUTO_MODEL, label: autoLabel }];
  for (const group of MODEL_GROUPS) {
    for (const model of group.models) items.push({ value: model.id, label: model.label });
  }
  return items;
}

export function RoleCard({
  role,
  setting,
  onChange,
}: {
  role: EAgentRole;
  setting: RoleSetting;
  onChange: (next: RoleSetting) => void;
}) {
  const meta = ROLE_META[role];
  const items = buildModelItems(meta.autoLabel);
  const effortLabel = EFFORT_STEPS.find((step) => step.effort === setting.effort)?.label;

  const handleModelChange = (model: string | null) => {
    if (model) onChange({ ...setting, model });
  };
  const handleEffortChange = (effort: EEffort) => onChange({ ...setting, effort });

  return (
    <SettingsSection title={meta.title} description={meta.description}>
      <SettingsCard>
        <SettingsRow
          title="Model"
          description="Auto picks the best available model for your connected providers."
          control={
            <Select items={items} value={setting.model} onValueChange={handleModelChange}>
              <SelectTrigger size="sm" className="w-48" aria-label={`${meta.title} model`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="end">
                <SelectItem value={AUTO_MODEL}>{meta.autoLabel}</SelectItem>
                {MODEL_GROUPS.map((group) => (
                  <SelectGroup key={group.provider}>
                    <SelectLabel>{group.provider}</SelectLabel>
                    {group.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title="Effort"
          description="Higher effort thinks longer and costs more per turn."
          control={<span className="font-mono text-xs text-muted-foreground">{effortLabel}</span>}
        >
          <EffortSlider
            value={setting.effort}
            onChange={handleEffortChange}
            label={`${meta.title} effort`}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
