'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Card, CardRow } from '@dltech/atlas-ui/components/card'
import {
  DEFAULT_FILE_MOUNT_MODE,
  EAccessMemberKind,
  REAUTH_REQUIRED_CODE,
  type AccessGrant,
  type AccessGrantMember,
} from '@dltech/atlas-wire/web'

import { formatFileMode, type TreeEntry } from '@/features/project-settings/data/file-mount-helpers'
import { runAction } from '@/features/settings/data/shared/run-action'
import { CloudApiError } from '@/lib/cloud-api'

import { AddSecretDialog, BulkAddDialog, type SecretPair } from '../env-secrets-dialogs'
import { LibraryConfirmDialog } from '../library-confirm-dialog'
import { LibraryRowMenu } from '../library-row-menu'
import { ReauthDialog } from '../reauth-dialog'
import { AccessFileDialog, type AccessFileDraft, type EditingFile } from './access-file-dialog'
import { moveTargetsOf } from './access-grant-helpers'
import { AccessMemberSection } from './access-grant-section'
import { FileMemberRow, SecretMemberRow } from './access-member-rows'
import type { AccessGrantsActions } from './use-access-grants'

export function AccessGrantCard({
  grant,
  grants,
  now,
  personal,
  entries,
  secretDescription,
  actions,
  onEditGrant,
  onDeleteGrant,
}: {
  grant: AccessGrant
  grants: readonly AccessGrant[]
  now: number
  personal: boolean
  entries: readonly TreeEntry[]
  secretDescription: string
  actions: AccessGrantsActions
  onEditGrant: () => void
  onDeleteGrant: () => void
}) {
  const targets = moveTargetsOf({ grants, fromGrantId: grant.id }).map((target) => ({
    id: target.id,
    name: target.name,
  }))
  const [editingSecret, setEditingSecret] = useState<string | null>(null)
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null)
  const [deletingSecret, setDeletingSecret] = useState<string | null>(null)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)
  const [openingFile, setOpeningFile] = useState<string | null>(null)
  const [reauthPath, setReauthPath] = useState<string | null>(null)

  const handleAddSecret = (pair: SecretPair) => {
    void runAction({
      work: () => actions.setSecret({ grantId: grant.id, name: pair.name, value: pair.value }),
      success: `Saved ${pair.name}`,
    })
  }
  const handleBulkAdd = ({ grantId, pairs }: { grantId: string; pairs: readonly SecretPair[] }) => {
    void runAction({
      work: async () => {
        for (const pair of pairs) await actions.setSecret({ grantId, ...pair })
      },
      success: `Saved ${pairs.length} ${pairs.length === 1 ? 'secret' : 'secrets'}`,
    })
  }
  const handleMoveMember = (args: {
    member: AccessGrantMember
    grantId: string
    label: string
  }) => {
    void runAction({
      work: () => actions.moveMember({ member: args.member, grantId: args.grantId }),
      success: `Moved ${args.label}`,
    })
  }
  const handleDeleteSecret = (name: string) => {
    setDeletingSecret(null)
    void runAction({ work: () => actions.removeSecret(name), success: `Deleted ${name}` })
  }
  const handleAddFile = (draft: AccessFileDraft) =>
    runAction({
      work: () => actions.setFile({ grantId: grant.id, ...draft }),
      success: `Saved ${draft.path}`,
    })
  const handleDeleteFile = (path: string) => {
    setDeletingFile(null)
    void runAction({ work: () => actions.removeFile(path), success: `Deleted ${path}` })
  }
  const handleEditFile = async (path: string) => {
    if (openingFile !== null) return
    setOpeningFile(path)
    try {
      const contents = await actions.revealFile(path)
      const file = grant.files.find((candidate) => candidate.path === path)
      setEditingFile({
        path,
        contents,
        modeText: formatFileMode(file?.mode ?? DEFAULT_FILE_MOUNT_MODE),
      })
    } catch (failure) {
      if (failure instanceof CloudApiError && failure.code === REAUTH_REQUIRED_CODE) {
        setReauthPath(path)
      } else {
        toast.error('Could not open the file')
      }
    } finally {
      setOpeningFile(null)
    }
  }
  const handleReauthOpenChange = (open: boolean) => {
    if (!open) setReauthPath(null)
  }
  const handleReauthConfirmed = () => {
    const path = reauthPath
    setReauthPath(null)
    if (path !== null) void handleEditFile(path)
  }

  return (
    <Card variant="list">
      <CardRow>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-medium">{grant.name}</h3>
            {grant.instruction === '' ? (
              <p className="text-sm text-muted-foreground">No instruction</p>
            ) : (
              <p className="max-w-prose text-sm text-muted-foreground">{grant.instruction}</p>
            )}
          </div>
          <LibraryRowMenu
            label={grant.name}
            actions={[
              { label: 'Edit grant', onSelect: onEditGrant },
              { label: 'Delete grant', onSelect: onDeleteGrant, destructive: true },
            ]}
          />
        </div>
        <AccessMemberSection
          title="Secrets"
          count={grant.secrets.length}
          emptyText="No secrets in this grant yet."
          action={
            <div className="flex items-center gap-2">
              <BulkAddDialog grantId={grant.id} onAdd={handleBulkAdd} />
              <AddSecretDialog
                description={secretDescription}
                triggerLabel="Add secret"
                triggerVariant="outline"
                onAdd={handleAddSecret}
              />
            </div>
          }
        >
          {grant.secrets.map((secret) => (
            <SecretMemberRow
              key={secret.name}
              name={secret.name}
              updatedAt={secret.updatedAt}
              now={now}
              targets={targets}
              reveal={() => actions.revealSecret(secret.name)}
              onEdit={() => setEditingSecret(secret.name)}
              onDelete={() => setDeletingSecret(secret.name)}
              onMove={(grantId) =>
                handleMoveMember({
                  member: { kind: EAccessMemberKind.Secret, name: secret.name },
                  grantId,
                  label: secret.name,
                })
              }
            />
          ))}
        </AccessMemberSection>
        <AccessMemberSection
          title="Files"
          count={grant.files.length}
          emptyText="No files in this grant yet."
          action={<AccessFileDialog personal={personal} entries={entries} onSave={handleAddFile} />}
        >
          {grant.files.map((file) => (
            <FileMemberRow
              key={file.path}
              path={file.path}
              mode={formatFileMode(file.mode)}
              updatedAt={file.updatedAt}
              now={now}
              targets={targets}
              reveal={() => actions.revealFile(file.path)}
              onEdit={() => void handleEditFile(file.path)}
              onDelete={() => setDeletingFile(file.path)}
              onMove={(grantId) =>
                handleMoveMember({
                  member: { kind: EAccessMemberKind.File, path: file.path },
                  grantId,
                  label: file.path,
                })
              }
            />
          ))}
        </AccessMemberSection>
      </CardRow>
      {editingSecret === null ? null : (
        <AddSecretDialog
          key={editingSecret}
          defaultOpen
          hideTrigger
          initialName={editingSecret}
          title="Change the secret value"
          submitLabel="Save value"
          description={secretDescription}
          onClosed={() => setEditingSecret(null)}
          onAdd={(pair) => {
            handleAddSecret(pair)
            setEditingSecret(null)
          }}
        />
      )}
      {editingFile === null ? null : (
        <AccessFileDialog
          key={editingFile.path}
          personal={personal}
          entries={entries}
          editing={editingFile}
          hideTrigger
          onClosed={() => setEditingFile(null)}
          onSave={handleAddFile}
        />
      )}
      <LibraryConfirmDialog
        open={deletingSecret !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingSecret(null)
        }}
        title={`Delete ${deletingSecret ?? 'the secret'}?`}
        description="The grant keeps the rest of its members. This cannot be undone."
        confirmLabel="Delete secret"
        onConfirm={() => {
          if (deletingSecret !== null) handleDeleteSecret(deletingSecret)
        }}
      />
      <LibraryConfirmDialog
        open={deletingFile !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFile(null)
        }}
        title={`Delete ${deletingFile ?? 'the file'}?`}
        description="The grant keeps the rest of its members. This cannot be undone."
        confirmLabel="Delete file"
        onConfirm={() => {
          if (deletingFile !== null) handleDeleteFile(deletingFile)
        }}
      />
      <ReauthDialog
        open={reauthPath !== null}
        onOpenChange={handleReauthOpenChange}
        onConfirmed={handleReauthConfirmed}
      />
    </Card>
  )
}
