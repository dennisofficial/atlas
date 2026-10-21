import { useState } from "react";
import { EllipsisIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dltech/atlas-ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dltech/atlas-ui/components/table";

import { ESecretScope, SECRETS, type SecretRow } from "../../fixtures/project-settings";
import { AddSecretDialog, BulkAddDialog, type SecretPair } from "./secrets-dialogs";
import { SettingsCard, SettingsSection } from "./settings-layout";

export enum ESecretsDialog {
  None = "none",
  Add = "add",
  BulkAdd = "bulk-add",
}

const MASK = "••••••••••••";

function MaskedValue({ row }: { row: SecretRow }) {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOffIcon : EyeIcon;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-mono text-xs text-muted-foreground">
        {revealed ? row.value : MASK}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${revealed ? "Hide" : "Reveal"} ${row.name}`}
        aria-pressed={revealed}
        onClick={() => setRevealed((current) => !current)}
      >
        <Icon />
      </Button>
    </span>
  );
}

function ScopeBadge({ row }: { row: SecretRow }) {
  if (row.scope === ESecretScope.Workspace) {
    return <Badge variant="outline">Workspace</Badge>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge variant="secondary">Project</Badge>
      {row.overridesWorkspace ? (
        <span className="truncate text-xs text-muted-foreground">overrides workspace</span>
      ) : null}
    </span>
  );
}

function RowMenu({ row, onDelete }: { row: SecretRow; onDelete: () => void }) {
  const inherited = row.scope === ESecretScope.Workspace;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {inherited ? (
          <>
            <DropdownMenuItem>Override in project</DropdownMenuItem>
            <DropdownMenuItem>Open workspace secrets</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem>Edit value</DropdownMenuItem>
            <DropdownMenuItem>Copy name</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SecretsTable({ rows, onDelete }: { rows: readonly SecretRow[]; onDelete: (name: string) => void }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[28%] pl-4">Name</TableHead>
          <TableHead className="w-[24%]">Value</TableHead>
          <TableHead className="w-[30%]">Scope</TableHead>
          <TableHead className="w-[12%]">Updated</TableHead>
          <TableHead className="w-12 pr-4">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.scope}-${row.name}`}>
            <TableCell className="truncate pl-4 font-mono text-xs font-medium">{row.name}</TableCell>
            <TableCell>
              <MaskedValue row={row} />
            </TableCell>
            <TableCell>
              <ScopeBadge row={row} />
            </TableCell>
            <TableCell className="text-muted-foreground">{row.updated}</TableCell>
            <TableCell className="pr-4 text-right">
              <RowMenu row={row} onDelete={() => onDelete(row.name)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SecretsEmpty() {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets or environment variables</EmptyTitle>
        <EmptyDescription>
          Add API keys and config the agent needs to build, test, and run this project. Paste a
          whole <span className="font-mono">.env</span> with Bulk add.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function upsert({ rows, pairs }: { rows: readonly SecretRow[]; pairs: readonly SecretPair[] }): SecretRow[] {
  const incoming = new Set(pairs.map((pair) => pair.name));
  const workspaceNames = new Set(
    rows.filter((row) => row.scope === ESecretScope.Workspace).map((row) => row.name),
  );
  const kept = rows.filter((row) => row.scope === ESecretScope.Workspace || !incoming.has(row.name));
  const added = pairs.map((pair) => ({
    name: pair.name,
    value: pair.value,
    scope: ESecretScope.Project,
    updated: "just now",
    overridesWorkspace: workspaceNames.has(pair.name),
  }));
  return [...added, ...kept];
}

export function SecretsPage({
  initialRows = SECRETS,
  openDialog = ESecretsDialog.None,
  bulkText = "",
}: {
  initialRows?: readonly SecretRow[];
  openDialog?: ESecretsDialog;
  bulkText?: string;
}) {
  const [rows, setRows] = useState<readonly SecretRow[]>(initialRows);
  const handleAdd = (pairs: readonly SecretPair[]) => setRows((current) => upsert({ rows: current, pairs }));
  const handleDelete = (name: string) =>
    setRows((current) =>
      current.filter((row) => row.scope === ESecretScope.Workspace || row.name !== name),
    );

  return (
    <SettingsSection
      title="Secrets & Env Vars"
      description={
        <>
          Order of precedence: default, then workspace, then personal, then project. The project
          value wins. Workspace values shown here are a preview of what will merge; sessions don&apos;t
          load project or workspace values yet.
        </>
      }
    >
      <SettingsCard>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h3 className="text-sm font-medium">
            Values
            {rows.length > 0 ? (
              <span className="ml-2 font-mono text-xs text-muted-foreground">{rows.length}</span>
            ) : null}
          </h3>
          <div className="flex items-center gap-2">
            <BulkAddDialog
              defaultOpen={openDialog === ESecretsDialog.BulkAdd}
              initialText={bulkText}
              onAdd={handleAdd}
            />
            <AddSecretDialog
              defaultOpen={openDialog === ESecretsDialog.Add}
              onAdd={(pair) => handleAdd([pair])}
            />
          </div>
        </div>
        {rows.length === 0 ? <SecretsEmpty /> : <SecretsTable rows={rows} onDelete={handleDelete} />}
      </SettingsCard>
    </SettingsSection>
  );
}
