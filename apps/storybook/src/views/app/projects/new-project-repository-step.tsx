import { ExternalLinkIcon, FolderGit2Icon, LockIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@dltech/atlas-ui/components/combobox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@dltech/atlas-ui/components/field";
import { NativeSelect, NativeSelectOption } from "@dltech/atlas-ui/components/native-select";
import { cn } from "@dltech/atlas-ui/lib/utils";

import { GITHUB_REPOS, RECENT_REPO_COUNT } from "./new-project-fixtures";
import { NewRepoForm } from "./new-project-new-repo";
import { branchChoices, defaultBranchOf, findGithubRepo, repoChoices, repoInputError } from "./new-project-repos";
import { EProjectSource, type DraftPatch, type ProjectDraft } from "./new-project-types";

const RECENT_REPOS = GITHUB_REPOS.slice(0, RECENT_REPO_COUNT);

function RecentTiles({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Recent repositories</p>
      <ul className="grid grid-cols-2 gap-2">
        {RECENT_REPOS.map((repo) => {
          const selected = draft.repo === repo.fullName;
          const handleClick = () => patch({ repo: repo.fullName, repoQuery: repo.fullName, branch: null });
          return (
            <li key={repo.fullName}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={handleClick}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-lg border border-border px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                  selected && "border-primary/40 bg-primary/5 hover:bg-primary/10",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm">
                  <FolderGit2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs font-medium">{repo.fullName}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {repo.isPrivate ? <LockIcon aria-label="Private" className="size-3" /> : null}
                  Updated {repo.updated}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PickerFooter() {
  const handleManage = (event: React.MouseEvent) => event.preventDefault();
  const handleRefresh = () => toast("Repositories refreshed", { description: "Pulled the latest list from GitHub." });
  return (
    <div className="flex items-center justify-between border-t border-border p-1">
      <Button variant="ghost" size="xs" onClick={handleRefresh}>
        <RefreshCwIcon data-icon="inline-start" />
        Refresh
      </Button>
      <Button variant="ghost" size="xs" render={<a href="#github-app" onClick={handleManage} />}>
        Manage on GitHub
        <ExternalLinkIcon data-icon="inline-end" />
      </Button>
    </div>
  );
}

function RepoPicker({ draft, patch, pickerOpen }: { draft: ProjectDraft; patch: DraftPatch; pickerOpen: boolean }) {
  const choices = repoChoices({ query: draft.repoQuery, excluded: [] });
  const error = repoInputError({ query: draft.repoQuery, choices });
  const handleValueChange = (next: string | null) => patch({ repo: next, repoQuery: next ?? "", branch: null });
  const handleInputChange = (next: string, details: { reason: string }) => {
    if (details.reason !== "input-change") return;
    patch({ repoQuery: next, repo: null, branch: null });
  };

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="repo-search">Find a repository</FieldLabel>
      <Combobox
        items={choices}
        filter={null}
        defaultOpen={pickerOpen}
        autoHighlight
        value={draft.repo}
        onValueChange={handleValueChange}
        inputValue={draft.repoQuery}
        onInputValueChange={handleInputChange}
      >
        <ComboboxInput
          id="repo-search"
          placeholder="Search, or paste a GitHub URL or owner/name"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <ComboboxContent>
          <ComboboxEmpty>{error ?? "No repositories match."}</ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name} className="font-mono text-xs">
                <FolderGit2Icon className="text-muted-foreground" />
                <span className="truncate">{name}</span>
                {findGithubRepo(name) ? null : (
                  <span className="font-sans text-muted-foreground">from pasted link</span>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
          <PickerFooter />
        </ComboboxContent>
      </Combobox>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function BranchField({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  if (!draft.repo) return null;
  const defaultBranch = defaultBranchOf(draft.repo);
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    patch({ branch: event.target.value || null });
  return (
    <Field>
      <FieldLabel htmlFor="repo-branch">Branch</FieldLabel>
      <NativeSelect id="repo-branch" className="w-full" value={draft.branch ?? ""} onChange={handleChange}>
        <NativeSelectOption value="">
          {defaultBranch ? `Default branch (${defaultBranch})` : "Default branch"}
        </NativeSelectOption>
        {branchChoices(draft.repo)
          .filter((branch) => branch !== defaultBranch)
          .map((branch) => (
            <NativeSelectOption key={branch} value={branch}>
              {branch}
            </NativeSelectOption>
          ))}
      </NativeSelect>
      <FieldDescription>Threads start from this branch unless you pick another.</FieldDescription>
    </Field>
  );
}

export function RepositoryStep({
  draft,
  patch,
  pickerOpen,
}: {
  draft: ProjectDraft;
  patch: DraftPatch;
  pickerOpen: boolean;
}) {
  if (draft.source === EProjectSource.NewRepo) return <NewRepoForm draft={draft} patch={patch} />;
  return (
    <div className="flex flex-col gap-4">
      <RecentTiles draft={draft} patch={patch} />
      <RepoPicker draft={draft} patch={patch} pickerOpen={pickerOpen} />
      <BranchField draft={draft} patch={patch} />
    </div>
  );
}
