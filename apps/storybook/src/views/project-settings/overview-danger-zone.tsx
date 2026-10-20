import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@dltech/atlas-ui/components/alert-dialog";
import { Button } from "@dltech/atlas-ui/components/button";
import { Input } from "@dltech/atlas-ui/components/input";
import { Label } from "@dltech/atlas-ui/components/label";

import { SettingsCard, SettingsRow, SettingsSection } from "./settings-layout";

function DeleteProjectDialog({ projectSlug }: { projectSlug: string }) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === projectSlug;
  return (
    <AlertDialog onOpenChange={(open) => (open ? null : setConfirmation(""))}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {projectSlug}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its threads, secrets, MCP servers, and sandbox snapshots are removed for everyone in the
            workspace. The GitHub repository is not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="delete-project-confirm" className="font-normal text-muted-foreground">
            Type <span className="font-mono text-foreground">{projectSlug}</span> to confirm
          </Label>
          <Input
            id="delete-project-confirm"
            className="font-mono"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={!confirmed}>
            Delete project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DangerZone({ projectSlug }: { projectSlug: string }) {
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard>
        <SettingsRow
          title="Transfer ownership"
          description="Move this project to another workspace or member. Threads and secrets move with it."
        >
          <Button variant="outline" size="sm">
            Transfer…
          </Button>
        </SettingsRow>
        <SettingsRow
          title="Delete project"
          description="Permanently remove the project and everything Atlas stores for it."
        >
          <DeleteProjectDialog projectSlug={projectSlug} />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
