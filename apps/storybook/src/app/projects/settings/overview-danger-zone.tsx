import { useState } from 'react'

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
} from '@dltech/atlas-ui/components/alert-dialog'
import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

import { SettingsCard, SettingsRow, SettingsSection } from '../../settings/settings-layout'

function DeleteProjectDialog({ projectSlug }: { projectSlug: string }) {
  const [confirmation, setConfirmation] = useState('')
  const confirmed = confirmation === projectSlug
  return (
    <AlertDialog onOpenChange={(open) => (open ? null : setConfirmation(''))}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {projectSlug}?</AlertDialogTitle>
          <AlertDialogDescription>
            The project and its secrets and MCP servers are deleted from Atlas. Existing threads and
            the GitHub repository are not touched.
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
  )
}

export function DangerZone({ projectSlug }: { projectSlug: string }) {
  return (
    <SettingsSection title="Danger zone">
      <SettingsCard>
        <SettingsRow
          title="Delete project"
          description="Removes the project, its secrets and MCP servers. Threads and the GitHub repository stay."
        >
          <DeleteProjectDialog projectSlug={projectSlug} />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
