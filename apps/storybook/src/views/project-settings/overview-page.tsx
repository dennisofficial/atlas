import { useState } from "react";
import {
  ArrowUpRightIcon,
  EllipsisIcon,
  FolderGit2Icon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dltech/atlas-ui/components/dropdown-menu";
import { Input } from "@dltech/atlas-ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@dltech/atlas-ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dltech/atlas-ui/components/select";

import {
  EShipBehavior,
    PROJECT,
  SHIP_BEHAVIORS,
  WORKSPACE_OPTIONS,
  type ProjectFixture,
} from "../../fixtures/project-settings";
import { DangerZone } from "./overview-danger-zone";
import {
  ERowLayout,
  MonogramTile,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from "./settings-layout";

type OverviewDraft = Pick<
  ProjectFixture,
  "name" | "description" | "baseBranch" | "shipBehavior" | "additionalRepositories" | "workspace"
>;

const LEGACY_MERGE_LABEL = "Merge when green (no longer offered)";

function shipItemsOf(current: EShipBehavior) {
  const items = SHIP_BEHAVIORS.map(({ value, label }) => ({ value, label, disabled: false }));
  if (items.some((item) => item.value === current)) return items;
  return [...items, { value: current, label: LEGACY_MERGE_LABEL, disabled: true }];
}

function isShipBehavior(value: unknown): value is EShipBehavior {
  return Object.values(EShipBehavior).some((behavior) => behavior === value);
}

function draftsEqual({ left, right }: { left: OverviewDraft; right: OverviewDraft }): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.baseBranch === right.baseBranch &&
    left.shipBehavior === right.shipBehavior &&
    left.workspace === right.workspace &&
    left.additionalRepositories.join("\n") === right.additionalRepositories.join("\n")
  );
}

function RepositoryControls() {
  const slug = `${PROJECT.owner}/${PROJECT.name}`;
  return (
    <>
      <a
        href={`https://github.com/${slug}`}
        className="mr-auto inline-flex min-w-0 items-center gap-1 font-mono text-sm text-foreground underline-offset-4 hover:underline sm:mr-0"
      >
        <span className="truncate">{slug}</span>
        <ArrowUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
      <Button variant="outline" size="sm">
        Clone
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh repository metadata">
        <RefreshCwIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Repository actions" />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem>Change repository…</DropdownMenuItem>
          <DropdownMenuItem>Reinstall GitHub app</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function AdditionalRepositories({
  repositories,
  onChange,
}: {
  repositories: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  const handleRemove = (index: number) => {
    onChange(repositories.filter((_, position) => position !== index));
  };
  const handleEdit = ({ index, value }: { index: number; value: string }) => {
    onChange(repositories.map((repo, position) => (position === index ? value : repo)));
  };
  return (
    <>
      {repositories.map((repo, index) => (
        <InputGroup key={index}>
          <InputGroupAddon>
            <FolderGit2Icon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={`Additional repository ${index + 1}`}
            className="font-mono"
            placeholder="owner/repo"
            value={repo}
            onChange={(event) => handleEdit({ index, value: event.target.value })}
          />
          <InputGroupAddon align="inline-end">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${repo || "repository"}`}
              onClick={() => handleRemove(index)}
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...repositories, ""])}
      >
        <PlusIcon data-icon="inline-start" />
        Add repository
      </Button>
    </>
  );
}

export function OverviewPage({
  initial = PROJECT,
  showWorkspace = true,
}: {
  initial?: ProjectFixture;
  showWorkspace?: boolean;
}) {
  const [saved, setSaved] = useState<OverviewDraft>(initial);
  const [draft, setDraft] = useState<OverviewDraft>(initial);
  const dirty = !draftsEqual({ left: draft, right: saved });

  const update = (patch: Partial<OverviewDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const handleShipChange = (value: unknown) => {
    if (isShipBehavior(value)) update({ shipBehavior: value });
  };

  const handleWorkspaceChange = (value: unknown) => {
    if (typeof value === "string") update({ workspace: value });
  };

  const shipItems = shipItemsOf(draft.shipBehavior);
  const shipDescription = SHIP_BEHAVIORS.find((item) => item.value === draft.shipBehavior)?.description;

  return (
    <>
      <SettingsSection title="Overview" description="How Atlas names, clones, and ships this project.">
        <SettingsCard
          footer={
            <>
              <UnsavedHint visible={dirty} />
              {dirty ? (
                <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
                  Discard
                </Button>
              ) : null}
              <Button size="sm" disabled={!dirty} onClick={() => setSaved(draft)}>
                Save
              </Button>
            </>
          }
        >
          <SettingsRow title="Name" htmlFor="project-name" description="Shown in the sidebar and on threads.">
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText className="font-mono">{initial.owner} /</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="project-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </InputGroup>
          </SettingsRow>
          {showWorkspace ? (
            <SettingsRow
              title="Workspace"
              htmlFor="project-workspace"
              description="The workspace this project belongs to. Members of the workspace can see it."
            >
              <Select items={WORKSPACE_OPTIONS} value={draft.workspace} onValueChange={handleWorkspaceChange}>
                <SelectTrigger id="project-workspace" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSPACE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          ) : null}
          <SettingsRow title="Project icon" description="A square image, at least 128×128.">
            <MonogramTile label={draft.name || initial.name} />
            <Button variant="outline" size="sm">
              Set icon
            </Button>
          </SettingsRow>
          <SettingsRow title="Description" htmlFor="project-description">
            <Input
              id="project-description"
              placeholder="What this project is for"
              value={draft.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </SettingsRow>
          <SettingsRow title="GitHub repository" description="Threads clone this repository into their sandbox.">
            <RepositoryControls />
          </SettingsRow>
          <SettingsRow
            title="Base branch"
            htmlFor="project-base-branch"
            description="New threads branch from here, and pull requests target it."
          >
            <Input
              id="project-base-branch"
              className="font-mono"
              placeholder={`Default branch (${initial.defaultBranch})`}
              value={draft.baseBranch}
              onChange={(event) => update({ baseBranch: event.target.value })}
            />
          </SettingsRow>
          <SettingsRow title="Ship behavior" htmlFor="project-ship" description={shipDescription}>
            <Select items={shipItems} value={draft.shipBehavior} onValueChange={handleShipChange}>
              <SelectTrigger id="project-ship" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shipItems.map((item) => (
                  <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            title="Additional repositories"
            description="Cloned next to the main repository, for threads that span repos."
            layout={ERowLayout.Stacked}
          >
            <AdditionalRepositories
              repositories={draft.additionalRepositories}
              onChange={(next) => update({ additionalRepositories: next })}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <DangerZone projectSlug={`${initial.owner}/${saved.name}`} />
    </>
  );
}
