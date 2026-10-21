import { useState } from "react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import { Input } from "@dltech/atlas-ui/components/input";

import { VERCEL_PROJECT_ID } from "../../fixtures/project-settings";
import { SettingsCard, SettingsRow, SettingsSection, UnsavedHint } from "./settings-layout";

const DESCRIPTION =
  "The Vercel project this project's sandboxes are created in. The token and team come from the workspace.";

export function VercelSection({ enabled = true }: { enabled?: boolean }) {
  const initial = enabled ? VERCEL_PROJECT_ID : "";
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const dirty = value.trim() !== saved;
  const disabled = !enabled;
  const handleSave = () => {
    setSaved(value.trim());
    setValue(value.trim());
  };
  return (
    <SettingsSection title="Vercel" actions={disabled ? <Badge variant="outline">Available soon</Badge> : null}>
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={disabled || !dirty} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow title="Vercel project ID" htmlFor="sandbox-vercel-project-id" description={DESCRIPTION}>
          <Input
            id="sandbox-vercel-project-id"
            className="font-mono"
            placeholder="prj_…"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
