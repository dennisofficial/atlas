import { useState } from 'react'
import { MoreHorizontalIcon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { TableCell, TableRow } from '@dltech/atlas-ui/components/table'

import {
  ASSIGNABLE_ROLE_OPTIONS,
  EWorkspaceRole,
  ROLE_LABELS,
  parseRole,
  type WorkspaceMember,
} from '../fixtures/settings-workspace'
import { Mono } from '../settings-layout'
import { WorkspaceSelect } from './workspace-select'

function MemberActions({
  member,
  onRoleChange,
  onRemoveRequest,
}: {
  member: WorkspaceMember
  onRoleChange: (role: EWorkspaceRole) => void
  onRemoveRequest: () => void
}) {
  const handleRoleValue = (next: string) => {
    const role = parseRole(next)
    if (role) onRoleChange(role)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Change role</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={member.role} onValueChange={handleRoleValue}>
              {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemoveRequest}>
          Remove from workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WorkspaceMemberRow({
  member,
  workspaceName,
  isSelf,
  onRoleChange,
  onRemove,
}: {
  member: WorkspaceMember
  workspaceName: string
  isSelf: boolean
  onRoleChange: (role: EWorkspaceRole) => void
  onRemove: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const locked = member.role === EWorkspaceRole.Owner || isSelf
  const handleRoleValue = (next: string) => {
    const role = parseRole(next)
    if (role) onRoleChange(role)
  }
  const handleConfirmRemove = () => {
    setConfirmOpen(false)
    onRemove()
  }
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar size="sm">
            <AvatarFallback>{member.initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {member.name}
              {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
            </span>
            <span className="truncate text-xs text-muted-foreground">{member.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {locked ? (
          <span className="px-2.5 text-sm text-muted-foreground">{ROLE_LABELS[member.role]}</span>
        ) : (
          <WorkspaceSelect
            size="sm"
            label={`Role for ${member.name}`}
            className="w-28"
            value={member.role}
            options={ASSIGNABLE_ROLE_OPTIONS}
            onChange={handleRoleValue}
          />
        )}
      </TableCell>
      <TableCell>
        <Mono className="text-muted-foreground">{member.joined}</Mono>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{member.lastActive}</TableCell>
      <TableCell className="w-10 text-right">
        {locked ? null : (
          <MemberActions
            member={member}
            onRoleChange={onRoleChange}
            onRemoveRequest={() => setConfirmOpen(true)}
          />
        )}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {member.email} loses access to {workspaceName}, its shared secrets and sandboxes.
                Their personal threads are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleConfirmRemove}>
                Remove from workspace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}
