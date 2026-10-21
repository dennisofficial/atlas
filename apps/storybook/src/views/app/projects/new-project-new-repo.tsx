import { Field, FieldDescription, FieldError, FieldLabel } from "@dltech/atlas-ui/components/field";
import { Input } from "@dltech/atlas-ui/components/input";
import { Label } from "@dltech/atlas-ui/components/label";
import { NativeSelect, NativeSelectOption } from "@dltech/atlas-ui/components/native-select";
import { Switch } from "@dltech/atlas-ui/components/switch";

import { newRepoErrorOf, NEW_REPO_ERROR_MESSAGES } from "./new-project-draft";
import { GITHUB_ACCOUNTS } from "./new-project-fixtures";
import type { DraftPatch, ProjectDraft } from "./new-project-types";

export function NewRepoForm({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const error = newRepoErrorOf({ owner: draft.newRepoOwner, name: draft.newRepoName });
  const handleOwnerChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    patch({ newRepoOwner: event.target.value });
  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patch({ newRepoName: event.target.value });
  const handlePrivateChange = (checked: boolean) => patch({ newRepoPrivate: checked });

  return (
    <div className="flex flex-col gap-4">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="new-repo-name">Repository name</FieldLabel>
        <div className="flex items-center gap-2">
          <NativeSelect aria-label="GitHub account" className="w-44 shrink-0" value={draft.newRepoOwner} onChange={handleOwnerChange}>
            {GITHUB_ACCOUNTS.map((account) => (
              <NativeSelectOption key={account} value={account}>
                {account}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <Input
            id="new-repo-name"
            value={draft.newRepoName}
            onChange={handleNameChange}
            placeholder="my-new-project"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {error ? <FieldError>{NEW_REPO_ERROR_MESSAGES[error]}</FieldError> : null}
      </Field>
      <Field orientation="horizontal" className="items-center justify-between rounded-lg border border-border p-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="new-repo-private">Private repository</Label>
          <FieldDescription>Only people you invite on GitHub can see it.</FieldDescription>
        </div>
        <Switch id="new-repo-private" checked={draft.newRepoPrivate} onCheckedChange={handlePrivateChange} />
      </Field>
    </div>
  );
}
