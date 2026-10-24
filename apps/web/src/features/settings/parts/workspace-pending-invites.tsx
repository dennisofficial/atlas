'use client'

import { MailIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import { ROLE_LABELS, type PendingInvite } from '../fixtures/settings-workspace'
import { Mono, SettingsSection } from '../settings-layout'

export function WorkspacePendingInvites({
  invites,
  canEdit,
  onResend,
  onRevoke,
}: {
  invites: PendingInvite[]
  canEdit: boolean
  onResend: (id: string) => void
  onRevoke: (id: string) => void
}) {
  return (
    <SettingsSection
      title="Pending invites"
      description="People who have been invited but have not joined yet."
    >
      {invites.length === 0 ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MailIcon />
            </EmptyMedia>
            <EmptyTitle>No pending invites</EmptyTitle>
            <EmptyDescription>
              Invitations you send show up here until they are accepted or expire. Invitations are
              recorded but no email is sent yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="framed">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Role</TableHead>
              <TableHead className="text-xs">Invited by</TableHead>
              <TableHead className="text-xs">Expires</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="text-sm font-medium">{invite.email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {ROLE_LABELS[invite.role]}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{invite.invitedBy}</TableCell>
                <TableCell>
                  <Mono className="text-muted-foreground">
                    {invite.expiresInDays === 0 ? 'today' : `in ${invite.expiresInDays}d`}
                  </Mono>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() => onResend(invite.id)}
                    >
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      className="text-destructive hover:text-destructive"
                      onClick={() => onRevoke(invite.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsSection>
  )
}
