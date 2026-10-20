import { useState } from "react";
import { ArrowUpRightIcon, CircleCheckIcon, CircleDashedIcon, SparklesIcon } from "lucide-react";

import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import { Label } from "@dltech/atlas-ui/components/label";
import { RadioGroup, RadioGroupItem } from "@dltech/atlas-ui/components/radio-group";
import { Textarea } from "@dltech/atlas-ui/components/textarea";
import { cn } from "@dltech/atlas-ui/lib/utils";

import {
  DEFAULT_SANDBOX_SIZE,
  REPO_FILES,
  SANDBOX_SIZES,
  SETUP_SCRIPT,
  SNAPSHOTS,
  type RepoFileStatus,
  type SandboxSize,
  type SandboxSnapshot,
} from "../../fixtures/project-settings";
import {
  ERowLayout,
  FileChip,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from "./settings-layout";

function SizeCard({ size }: { size: SandboxSize }) {
  const id = `sandbox-size-${size.id}`;
  const disabled = size.unavailableReason !== undefined;
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer flex-col items-stretch gap-3 rounded-lg border bg-card p-3 font-normal transition-colors",
        "hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5",
        "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50 hover:bg-card",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium">{size.id}</span>
        <RadioGroupItem id={id} value={size.id} disabled={disabled} />
      </span>
      <span className="font-mono text-xs leading-relaxed text-muted-foreground">
        {size.vcpus} vCPU · {size.memoryGb} GB RAM
        <br />
        {size.diskGb} GB disk
      </span>
      <span className="text-sm">
        <span className="font-semibold">{size.pricePerHour}</span>
        <span className="text-muted-foreground">/hour</span>
      </span>
      {disabled ? <span className="text-xs text-muted-foreground">{size.unavailableReason}</span> : null}
    </Label>
  );
}

function SizePicker() {
  const [saved, setSaved] = useState(DEFAULT_SANDBOX_SIZE);
  const [selected, setSelected] = useState(DEFAULT_SANDBOX_SIZE);
  const dirty = selected !== saved;
  const handleValueChange = (value: unknown) => {
    if (typeof value === "string") setSelected(value);
  };
  return (
    <SettingsSection
      title="Sandbox size"
      description="Resources for every new thread in this project. Billed by the minute; paused when idle."
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty} onClick={() => setSaved(selected)}>
              Save
            </Button>
          </>
        }
      >
        <div className="p-4">
          <RadioGroup
            aria-label="Sandbox size"
            value={selected}
            onValueChange={handleValueChange}
            className="grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {SANDBOX_SIZES.map((size) => (
              <SizeCard key={size.id} size={size} />
            ))}
          </RadioGroup>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function DocsBadge() {
  return (
    <Badge variant="outline" render={<a href="https://github.com/dennisofficial/atlas" />}>
      Docs
      <ArrowUpRightIcon data-icon="inline-end" />
    </Badge>
  );
}

function SetupScript() {
  const [saved, setSaved] = useState(SETUP_SCRIPT);
  const [script, setScript] = useState(SETUP_SCRIPT);
  const dirty = script !== saved;
  return (
    <SettingsSection
      title="Setup script"
      description="Runs once after the repository is cloned, before the agent starts. Its result is snapshotted."
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty} onClick={() => setSaved(script)}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          title={
            <>
              <Label htmlFor="sandbox-setup-script">Setup</Label>
              <DocsBadge />
            </>
          }
          description={
            <>
              Overrides <FileChip>setup</FileChip> in <FileChip>.atlas/container.json</FileChip> when
              both are set.
            </>
          }
          layout={ERowLayout.Stacked}
        >
          <Textarea
            id="sandbox-setup-script"
            spellCheck={false}
            className="min-h-32 font-mono text-xs md:text-xs"
            value={script}
            onChange={(event) => setScript(event.target.value)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function RepoFileRow({ file }: { file: RepoFileStatus }) {
  const StatusIcon = file.present ? CircleCheckIcon : CircleDashedIcon;
  return (
    <SettingsRow title={<FileChip>{file.path}</FileChip>} description={file.description}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm",
          file.present ? "text-success" : "text-muted-foreground",
        )}
      >
        <StatusIcon className="size-4" />
        {file.present ? "Present on main" : "Not present on main"}
      </span>
    </SettingsRow>
  );
}

function RepoFiles({ files }: { files: readonly RepoFileStatus[] }) {
  return (
    <SettingsSection
      title="Repository files"
      description="Atlas reads these from the base branch when it builds the sandbox image."
    >
      <SettingsCard
        footer={
          <Button variant="outline" size="sm">
            <SparklesIcon data-icon="inline-start" />
            Set up with Atlas
          </Button>
        }
      >
        {files.map((file) => (
          <RepoFileRow key={file.path} file={file} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function SnapshotRow({ snapshot, onDelete }: { snapshot: SandboxSnapshot; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="font-mono text-sm">{snapshot.size}</span>
      {snapshot.isProjectDefault ? <Badge variant="secondary">Project default</Badge> : null}
      <span className="ml-auto text-sm text-muted-foreground">{snapshot.cachedFor}</span>
      <Button variant="outline" size="sm" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

function Snapshots() {
  const [snapshots, setSnapshots] = useState(SNAPSHOTS);
  const handleDelete = (id: string) => setSnapshots((current) => current.filter((item) => item.id !== id));
  return (
    <SettingsSection
      title="Snapshots"
      description="A snapshot is the sandbox right after setup, so new threads skip the clone and install. Deleting one rebuilds it on the next thread."
    >
      <SettingsCard>
        {snapshots.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No snapshots yet. The next thread in this project creates one.
          </p>
        ) : (
          snapshots.map((snapshot) => (
            <SnapshotRow key={snapshot.id} snapshot={snapshot} onDelete={() => handleDelete(snapshot.id)} />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

export function SandboxPage({ repoFiles = REPO_FILES }: { repoFiles?: readonly RepoFileStatus[] }) {
  return (
    <>
      <SizePicker />
      <SetupScript />
      <RepoFiles files={repoFiles} />
      <Snapshots />
    </>
  );
}
