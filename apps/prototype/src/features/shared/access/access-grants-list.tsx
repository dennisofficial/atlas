import { type ReactNode } from 'react'
import { EllipsisIcon, FileKeyIcon, KeyRoundIcon, LockKeyholeIcon, PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Card, CardRow } from '@dltech/atlas-ui/components/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import type { FixtureGrant } from './fixtures'

function MemberRow({
  icon,
  label,
  detail,
  updated,
}: {
  icon: 'secret' | 'file'
  label: string
  detail: string
  updated: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      {icon === 'secret' ? (
        <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileKeyIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{label}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{detail}</span>
      <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">
        {updated}
      </span>
      <span className="flex w-7 shrink-0 justify-center text-muted-foreground">
        <EllipsisIcon className="size-3.5" />
      </span>
    </div>
  )
}

function MemberSection({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string
  count: number
  emptyText: string
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          {title}
          <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>
        </h4>
        {action}
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="divide-y rounded-lg border">{children}</div>
      )}
    </div>
  )
}

export function GrantCard({ grant }: { grant: FixtureGrant }) {
  return (
    <Card variant="list">
      <CardRow>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-sm font-medium">{grant.name}</h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              {grant.instruction === '' ? 'No instruction' : grant.instruction}
            </p>
          </div>
          <span className="text-muted-foreground">
            <EllipsisIcon className="size-4" />
          </span>
        </div>
        <MemberSection
          title="Secrets"
          count={grant.secrets.length}
          emptyText="No secrets in this grant yet."
          action={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">
                Bulk add
              </Button>
              <Button variant="outline" size="sm">
                <PlusIcon data-icon="inline-start" />
                Add secret
              </Button>
            </div>
          }
        >
          {grant.secrets.map((secret) => (
            <MemberRow
              key={secret.name}
              icon="secret"
              label={secret.name}
              detail="••••••••••••"
              updated={secret.updated}
            />
          ))}
        </MemberSection>
        <MemberSection
          title="Files"
          count={grant.files.length}
          emptyText="No files in this grant yet."
          action={
            <Button variant="outline" size="sm">
              <PlusIcon data-icon="inline-start" />
              Add file
            </Button>
          }
        >
          {grant.files.map((file) => (
            <MemberRow
              key={file.path}
              icon="file"
              label={file.path}
              detail={file.mode}
              updated={file.updated}
            />
          ))}
        </MemberSection>
      </CardRow>
    </Card>
  )
}

export function AccessGrantsList({ grants }: { grants: FixtureGrant[] }) {
  if (grants.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockKeyholeIcon />
          </EmptyMedia>
          <EmptyTitle>No access grants yet</EmptyTitle>
          <EmptyDescription>
            A grant groups the secrets and files one job needs. Create a grant, then add its secrets
            and files, and tell the agent what they unlock.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            New grant
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Grants
          <span className="ml-2 font-mono text-xs text-muted-foreground">{grants.length}</span>
        </h3>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          New grant
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        {grants.map((grant) => (
          <GrantCard key={grant.id} grant={grant} />
        ))}
      </div>
    </>
  )
}
