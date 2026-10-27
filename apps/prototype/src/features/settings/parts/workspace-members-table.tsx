import { SearchIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

import {
  CURRENT_MEMBER_ID,
  EWorkspaceRole,
  ROLE_LABELS,
  type SelectOption,
  type WorkspaceMember,
} from '../fixtures/settings-workspace'
import { WorkspaceMemberRow } from './workspace-member-row'
import { WorkspaceSelect } from './workspace-select'

export const ALL_ROLES = 'all'

export const ROLE_FILTER_OPTIONS: SelectOption[] = [
  { value: ALL_ROLES, label: 'All roles' },
  ...Object.values(EWorkspaceRole).map((role) => ({ value: role, label: ROLE_LABELS[role] })),
]

export function WorkspaceMembersToolbar({
  query,
  roleFilter,
  onQueryChange,
  onRoleFilterChange,
}: {
  query: string
  roleFilter: string
  onQueryChange: (query: string) => void
  onRoleFilterChange: (role: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="min-w-48 flex-1">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search members"
          placeholder="Search by name or email…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </InputGroup>
      <WorkspaceSelect
        label="Filter by role"
        className="w-36"
        value={roleFilter}
        options={ROLE_FILTER_OPTIONS}
        onChange={onRoleFilterChange}
      />
    </div>
  )
}

export function WorkspaceMembersTable({
  members,
  workspaceName,
  onRoleChange,
  onRemove,
}: {
  members: WorkspaceMember[]
  workspaceName: string
  onRoleChange: (params: { id: string; role: EWorkspaceRole }) => void
  onRemove: (id: string) => void
}) {
  return (
    <Table variant="framed" className="min-w-xl">
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Member</TableHead>
          <TableHead className="text-xs">Role</TableHead>
          <TableHead className="text-xs">Joined</TableHead>
          <TableHead className="text-xs">Last active</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <WorkspaceMemberRow
            key={member.id}
            member={member}
            workspaceName={workspaceName}
            isSelf={member.id === CURRENT_MEMBER_ID}
            onRoleChange={(role) => onRoleChange({ id: member.id, role })}
            onRemove={() => onRemove(member.id)}
          />
        ))}
        {members.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
              No members match your filters.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}
