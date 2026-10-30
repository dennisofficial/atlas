'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

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

import { PROJECTS_KEY, SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import { useProjectContext } from './data/project-context'
import { deleteProject } from './data/project-api'
import { SettingsCard, SettingsRow, SettingsSection } from './settings-layout'

function DeleteProjectDialog({ projectSlug }: { projectSlug: string }) {
  const router = useRouter()
  const invalidateCloud = useInvalidateCloud()
  const { projectId } = useProjectContext()
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const confirmed = confirmation === projectSlug

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteProject(projectId)
      await invalidateCloud([PROJECTS_KEY, SHELL_THREADS_KEY])
      toast.success('Project deleted')
      router.push('/threads')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the project')
      setDeleting(false)
    }
  }

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
          <AlertDialogAction
            variant="destructive"
            disabled={!confirmed || deleting}
            onClick={() => void handleDelete()}
          >
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
          description="Permanently remove the project and everything Atlas stores for it."
        >
          <DeleteProjectDialog projectSlug={projectSlug} />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
