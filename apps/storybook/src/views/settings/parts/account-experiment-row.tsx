import { Badge } from "@dltech/atlas-ui/components/badge";
import { Switch } from "@dltech/atlas-ui/components/switch";

import type { Experiment } from "../../../fixtures/settings-account";
import { SettingsRow } from "../settings-layout";

export function AccountExperimentRow({
  experiment,
  enabled,
  onToggle,
}: {
  experiment: Experiment;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <SettingsRow
      title={
        <>
          {experiment.title}
          {experiment.beta ? <Badge variant="secondary">Beta</Badge> : null}
        </>
      }
      description={experiment.description}
      control={
        <Switch aria-label={experiment.title} checked={enabled} onCheckedChange={onToggle} />
      }
    />
  );
}
