'use client'

import { useState } from 'react'
import { EyeIcon, EyeOffIcon, FileKeyIcon, KeyRoundIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { REAUTH_REQUIRED_CODE } from '@dltech/atlas-wire/web'

import { relativeTimeOf } from '@/features/settings/data/shared/relative-time'
import { CloudApiError } from '@/lib/cloud-api'

import { LibraryRowMenu } from '../library-row-menu'
import { ReauthDialog } from '../reauth-dialog'
import { SecretValueCell } from '../secret-value-cell'

export type MoveTarget = { id: string; name: string }

function MemberRowMenu({
  label,
  targets,
  onEdit,
  onDelete,
  onMove,
}: {
  label: string
  targets: readonly MoveTarget[]
  onEdit: () => void
  onDelete: () => void
  onMove: (grantId: string) => void
}) {
  return (
    <LibraryRowMenu
      label={label}
      actions={[
        { label: 'Edit', onSelect: onEdit },
        ...(targets.length === 0
          ? []
          : [
              {
                label: 'Move to',
                items: targets.map((target) => ({
                  label: target.name,
                  onSelect: () => onMove(target.id),
                })),
              },
            ]),
        { label: 'Delete', onSelect: onDelete, destructive: true },
      ]}
    />
  )
}

const MEMBER_ROW_CLASS = 'flex min-w-0 items-center gap-2 px-3 py-2'
const UPDATED_CLASS = 'hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block'

export function SecretMemberRow({
  name,
  updatedAt,
  now,
  targets,
  reveal,
  onEdit,
  onDelete,
  onMove,
}: {
  name: string
  updatedAt: string
  now: number
  targets: readonly MoveTarget[]
  reveal: () => Promise<string>
  onEdit: () => void
  onDelete: () => void
  onMove: (grantId: string) => void
}) {
  return (
    <div className={MEMBER_ROW_CLASS}>
      <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={name}>
        {name}
      </span>
      <SecretValueCell name={name} fetchValue={reveal} />
      <span className={UPDATED_CLASS}>{relativeTimeOf({ iso: updatedAt, now })}</span>
      <MemberRowMenu
        label={name}
        targets={targets}
        onEdit={onEdit}
        onDelete={onDelete}
        onMove={onMove}
      />
    </div>
  )
}

export function FileMemberRow({
  path,
  mode,
  updatedAt,
  now,
  targets,
  reveal,
  onEdit,
  onDelete,
  onMove,
}: {
  path: string
  mode: string
  updatedAt: string
  now: number
  targets: readonly MoveTarget[]
  reveal: () => Promise<string>
  onEdit: () => void
  onDelete: () => void
  onMove: (grantId: string) => void
}) {
  const [contents, setContents] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [reauthOpen, setReauthOpen] = useState(false)
  const revealed = contents !== null

  const fetchContents = async () => {
    setRevealing(true)
    try {
      setContents(await reveal())
    } catch (error) {
      if (error instanceof CloudApiError && error.code === REAUTH_REQUIRED_CODE) {
        setReauthOpen(true)
      } else {
        toast.error('Could not reveal the file')
      }
    } finally {
      setRevealing(false)
    }
  }
  const handleToggle = () => {
    if (revealed) {
      setContents(null)
      return
    }
    void fetchContents()
  }
  const handleConfirmed = () => {
    setReauthOpen(false)
    void fetchContents()
  }

  return (
    <div className="flex flex-col">
      <div className={MEMBER_ROW_CLASS}>
        <FileKeyIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={path}>
          {path}
        </span>
        <span className="hidden w-12 shrink-0 font-mono text-xs text-muted-foreground sm:block">
          {mode}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={revealing}
          aria-label={`${revealed ? 'Hide' : 'Reveal'} ${path}`}
          aria-pressed={revealed}
          onClick={handleToggle}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        <span className={UPDATED_CLASS}>{relativeTimeOf({ iso: updatedAt, now })}</span>
        <MemberRowMenu
          label={path}
          targets={targets}
          onEdit={onEdit}
          onDelete={onDelete}
          onMove={onMove}
        />
      </div>
      {contents === null ? null : (
        <pre className="mx-3 mb-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
          {contents}
        </pre>
      )}
      <ReauthDialog open={reauthOpen} onOpenChange={setReauthOpen} onConfirmed={handleConfirmed} />
    </div>
  )
}
