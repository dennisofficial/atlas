import { useState, type ReactNode } from "react";
import { KeyRoundIcon, PlusIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";

import {
  ELibraryScope,
  type LibrarySecret,
  type LibraryMember,
} from "../../../fixtures/settings-library";
import { SettingsCard, SettingsPage, SettingsSection } from "../settings-layout";
import { LibraryConfirmDialog } from "./library-confirm-dialog";
import {
  BulkAddDialog,
  SecretDialog,
  type SecretEntry,
} from "./library-secret-dialogs";
import { SecretRow } from "./library-secret-row";

export function SecretsView({
  scope,
  description,
  sectionDescription,
  lead,
  initial,
  currentMember,
}: {
  scope: ELibraryScope;
  description: ReactNode;
  sectionDescription: string;
  lead?: ReactNode;
  initial: LibrarySecret[];
  currentMember: LibraryMember;
}) {
  const [secrets, setSecrets] = useState(initial);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<LibrarySecret | null>(null);
  const [deleting, setDeleting] = useState<LibrarySecret | null>(null);

  const handleAdd = (entry: SecretEntry) => {
    setSecrets((current) => [
      { id: `new-${entry.key}`, ...entry, updated: "just now", addedBy: currentMember },
      ...current.filter((secret) => secret.key !== entry.key),
    ]);
  };

  const handleBulkAdd = (entries: SecretEntry[]) => entries.forEach(handleAdd);

  const handleEdit = (entry: SecretEntry) => {
    setSecrets((current) =>
      current.map((secret) =>
        secret.key === entry.key
          ? {
              ...secret,
              kind: entry.kind,
              value: entry.value || secret.value,
              updated: "just now",
            }
          : secret,
      ),
    );
  };

  const handleDelete = () => {
    setSecrets((current) => current.filter((secret) => secret.id !== deleting?.id));
    setDeleting(null);
  };

  const isWorkspace = scope === ELibraryScope.Workspace;

  return (
    <SettingsPage title="Secrets & Env Vars" description={description}>
      {lead}
      <SettingsSection
        title="Values"
        description={sectionDescription}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              Bulk add
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add
            </Button>
          </>
        }
      >
        {secrets.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>No secrets or environment variables yet.</EmptyTitle>
              <EmptyDescription>
                Add a value and it is injected into {isWorkspace ? "every member's" : "your"}{" "}
                sandboxes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SettingsCard>
            {secrets.map((secret) => (
              <SecretRow
                key={secret.id}
                secret={secret}
                showAddedBy={isWorkspace}
                onEdit={() => setEditing(secret)}
                onDelete={() => setDeleting(secret)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>

      <SecretDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        scope={scope}
        initial={null}
        onSubmit={handleAdd}
      />
      <SecretDialog
        key={`edit-${editing?.id ?? "none"}`}
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        scope={scope}
        initial={editing}
        onSubmit={handleEdit}
      />
      <BulkAddDialog
        key={`bulk-${bulkOpen}`}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSubmit={handleBulkAdd}
      />
      <LibraryConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.key ?? "value"}?`}
        description={
          isWorkspace
            ? "Threads in this workspace stop receiving it on their next sandbox start."
            : "Your threads stop receiving it on their next sandbox start."
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </SettingsPage>
  );
}
