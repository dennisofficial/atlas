import { useState } from "react";

import {
  PENDING_INVITES,
  WORKSPACE_MEMBERS,
  type EWorkspaceRole,
  type PendingInvite,
} from "../../../fixtures/settings-workspace";
import { WorkspaceInviteDialog } from "../parts/workspace-invite-dialog";
import {
  ALL_ROLES,
  WorkspaceMembersTable,
  WorkspaceMembersToolbar,
} from "../parts/workspace-members-table";
import { WorkspacePendingInvites } from "../parts/workspace-pending-invites";
import { SettingsPage, SettingsSection } from "../settings-layout";

const CURRENT_USER_NAME = "Dennis Lysenko";
const INVITE_LIFETIME_DAYS = 7;

export function WorkspaceMembersPage({
  defaultInviteOpen = false,
  initialPending = PENDING_INVITES,
}: {
  defaultInviteOpen?: boolean;
  initialPending?: PendingInvite[];
}) {
  const [members, setMembers] = useState(WORKSPACE_MEMBERS);
  const [pending, setPending] = useState(initialPending);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES);

  const needle = query.trim().toLowerCase();
  const visible = members.filter((member) => {
    const matchesRole = roleFilter === ALL_ROLES || member.role === roleFilter;
    const matchesQuery =
      needle === "" ||
      member.name.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle);
    return matchesRole && matchesQuery;
  });

  const handleRoleChange = ({ id, role }: { id: string; role: EWorkspaceRole }) =>
    setMembers((current) =>
      current.map((member) => (member.id === id ? { ...member, role } : member)),
    );
  const handleRemove = (id: string) =>
    setMembers((current) => current.filter((member) => member.id !== id));
  const handleInvite = ({ emails, role }: { emails: string[]; role: EWorkspaceRole }) =>
    setPending((current) => [
      ...emails.map((email) => ({
        id: `inv_${email}`,
        email,
        role,
        invitedBy: CURRENT_USER_NAME,
        expiresInDays: INVITE_LIFETIME_DAYS,
      })),
      ...current,
    ]);
  const handleResend = (id: string) =>
    setPending((current) =>
      current.map((invite) =>
        invite.id === id ? { ...invite, expiresInDays: INVITE_LIFETIME_DAYS } : invite,
      ),
    );
  const handleRevoke = (id: string) =>
    setPending((current) => current.filter((invite) => invite.id !== id));

  return (
    <SettingsPage
      title="Members"
      description="Manage who can access DL Tech and what they can do."
      actions={<WorkspaceInviteDialog defaultOpen={defaultInviteOpen} onInvite={handleInvite} />}
    >
      <SettingsSection
        title="Members"
        description={`${members.length} ${members.length === 1 ? "person" : "people"} in this workspace.`}
      >
        <WorkspaceMembersToolbar
          query={query}
          roleFilter={roleFilter}
          onQueryChange={setQuery}
          onRoleFilterChange={setRoleFilter}
        />
        <WorkspaceMembersTable
          members={visible}
          onRoleChange={handleRoleChange}
          onRemove={handleRemove}
        />
      </SettingsSection>
      <WorkspacePendingInvites
        invites={pending}
        onResend={handleResend}
        onRevoke={handleRevoke}
      />
    </SettingsPage>
  );
}
