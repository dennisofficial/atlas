import { useState } from "react";

import { EXPERIMENTS } from "../../../fixtures/settings-account";
import { AccountExperimentRow } from "../parts/account-experiment-row";
import { SettingsCard, SettingsPage } from "../settings-layout";

export function ExperimentalPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXPERIMENTS.map((experiment) => [experiment.id, experiment.enabled])),
  );

  const handleToggle = (id: string, next: boolean) =>
    setEnabled((current) => ({ ...current, [id]: next }));

  return (
    <SettingsPage
      title="Experimental"
      description="Try features that are still being shaped. They apply to new threads."
    >
      <SettingsCard>
        {EXPERIMENTS.map((experiment) => (
          <AccountExperimentRow
            key={experiment.id}
            experiment={experiment}
            enabled={enabled[experiment.id] ?? experiment.enabled}
            onToggle={(next) => handleToggle(experiment.id, next)}
          />
        ))}
      </SettingsCard>
      <p className="text-xs text-muted-foreground">
        Experiments may change behavior or disappear between releases.
      </p>
    </SettingsPage>
  );
}
