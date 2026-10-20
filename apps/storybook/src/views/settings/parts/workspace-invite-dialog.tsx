import { useState } from "react";
import { UserPlusIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dltech/atlas-ui/components/dialog";
import { Label } from "@dltech/atlas-ui/components/label";
import { Textarea } from "@dltech/atlas-ui/components/textarea";

import {
  ASSIGNABLE_ROLE_OPTIONS,
  EWorkspaceRole,
  parseRole,
} from "../../../fixtures/settings-workspace";
import { WorkspaceSelect } from "./workspace-select";

export function parseEmails(raw: string): string[] {
  const emails = raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(emails));
}

export function WorkspaceInviteDialog({
  defaultOpen = false,
  onInvite,
}: {
  defaultOpen?: boolean;
  onInvite: (params: { emails: string[]; role: EWorkspaceRole }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState("");
  const [role, setRole] = useState(EWorkspaceRole.Member);
  const emails = parseEmails(raw);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setRaw("");
  };
  const handleSend = () => {
    onInvite({ emails, role });
    handleOpenChange(false);
  };
  const handleRoleChange = (next: string) => setRole(parseRole(next) ?? EWorkspaceRole.Member);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlusIcon data-icon="inline-start" />
        Invite members
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite members to DL Tech</DialogTitle>
          <DialogDescription>
            Invites are sent by email and expire after 7 days.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-emails">Email addresses</Label>
            <Textarea
              id="invite-emails"
              className="min-h-24 text-sm"
              placeholder="maya@dltech.dev, tomas@dltech.dev"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separate addresses with commas, spaces or new lines.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label>Role</Label>
            <WorkspaceSelect
              label="Invite role"
              className="w-40"
              value={role}
              options={ASSIGNABLE_ROLE_OPTIONS}
              onChange={handleRoleChange}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={emails.length === 0} onClick={handleSend}>
            {emails.length > 1 ? `Send ${emails.length} invites` : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
