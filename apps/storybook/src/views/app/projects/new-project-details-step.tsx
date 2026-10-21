import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@dltech/atlas-ui/components/avatar";
import { Button } from "@dltech/atlas-ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@dltech/atlas-ui/components/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@dltech/atlas-ui/components/field";
import { Input } from "@dltech/atlas-ui/components/input";
import { RadioGroup, RadioGroupItem } from "@dltech/atlas-ui/components/radio-group";
import { Textarea } from "@dltech/atlas-ui/components/textarea";

import { ENameError, NAME_ERROR_MESSAGES } from "./new-project-draft";
import { BAD_REPO_INPUT_MESSAGE, ERepoInputKind, parseRepoInput } from "./new-project-repos";
import { MAX_ADDITIONAL_REPOS, type DraftPatch, type ProjectDraft } from "./new-project-types";
import { EOwnerKind, PROJECT_OWNERS } from "./projects.fixtures";

function OwnerCards({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const handleChange = (value: unknown) => {
    if (typeof value === "string") patch({ ownerId: value });
  };
  return (
    <RadioGroup value={draft.ownerId} onValueChange={handleChange} className="grid-cols-2" aria-label="Owner">
      {PROJECT_OWNERS.map((owner) => {
        const isPrivate = owner.kind === EOwnerKind.Personal;
        return (
          <FieldLabel key={owner.id} htmlFor={`owner-${owner.id}`}>
            <Field orientation="horizontal">
              <Avatar size="sm">
                <AvatarFallback>{owner.initials}</AvatarFallback>
              </Avatar>
              <FieldContent>
                <FieldTitle>{isPrivate ? "Private" : "Workspace"}</FieldTitle>
                <FieldDescription>{isPrivate ? `Only you · ${owner.name}` : owner.name}</FieldDescription>
              </FieldContent>
              <RadioGroupItem value={owner.id} id={`owner-${owner.id}`} />
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}

function AdditionalRepos({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const [open, setOpen] = useState(draft.additionalRepos.length > 0);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const atLimit = draft.additionalRepos.length >= MAX_ADDITIONAL_REPOS;

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
    setError(null);
  };
  const handleAdd = () => {
    const parsed = parseRepoInput(input);
    if (parsed.kind === ERepoInputKind.Empty) return;
    if (parsed.kind === ERepoInputKind.Invalid) return setError(BAD_REPO_INPUT_MESSAGE);
    const known = draft.additionalRepos.includes(parsed.repo) || parsed.repo === draft.repo;
    if (known) return setError("That repository is already part of this project.");
    patch({ additionalRepos: [...draft.additionalRepos, parsed.repo] });
    setInput("");
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleAdd();
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/extra flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon aria-hidden className="size-4 transition-transform group-data-[panel-open]/extra:rotate-90" />
        Add additional repositories
        {draft.additionalRepos.length > 0 ? (
          <span className="font-mono text-xs tabular-nums">{draft.additionalRepos.length}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <FieldDescription>Threads can read and edit these alongside the main repository.</FieldDescription>
        <ul className="flex flex-col gap-1">
          {draft.additionalRepos.map((repo) => {
            const handleRemove = () =>
              patch({ additionalRepos: draft.additionalRepos.filter((candidate) => candidate !== repo) });
            return (
              <li key={repo} className="flex items-center justify-between rounded-md border border-border py-1 pr-1 pl-2.5">
                <span className="font-mono text-xs">{repo}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`Remove ${repo}`} onClick={handleRemove}>
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <Input
            aria-label="Additional repository"
            aria-invalid={error ? true : undefined}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={atLimit}
            placeholder={atLimit ? `Limit of ${MAX_ADDITIONAL_REPOS} reached` : "owner/name or GitHub URL"}
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="outline" onClick={handleAdd} disabled={atLimit || !input.trim()}>
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DetailsStep({
  draft,
  patch,
  nameError,
}: {
  draft: ProjectDraft;
  patch: DraftPatch;
  nameError: ENameError | null;
}) {
  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patch({ name: event.target.value, nameTouched: true });
  const handleDescriptionChange = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    patch({ description: event.target.value });

  return (
    <div className="flex flex-col gap-4">
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor="project-name">Name</FieldLabel>
        <Input
          id="project-name"
          value={draft.name}
          onChange={handleNameChange}
          placeholder="my-project"
          aria-invalid={nameError ? true : undefined}
          autoComplete="off"
        />
        {nameError ? <FieldError>{NAME_ERROR_MESSAGES[nameError]}</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel>Owner</FieldLabel>
        <OwnerCards draft={draft} patch={patch} />
      </Field>
      <Field>
        <FieldLabel htmlFor="project-description">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="project-description"
          value={draft.description}
          onChange={handleDescriptionChange}
          placeholder="What this project is for"
          rows={2}
        />
      </Field>
      <AdditionalRepos draft={draft} patch={patch} />
    </div>
  );
}
