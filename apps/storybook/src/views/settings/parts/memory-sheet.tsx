import { PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@dltech/atlas-ui/components/field";
import { Input } from "@dltech/atlas-ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dltech/atlas-ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@dltech/atlas-ui/components/sheet";
import { Textarea } from "@dltech/atlas-ui/components/textarea";

import {
  EMemoryType,
  MEMORY_TYPE_OPTIONS,
  type MemoryEntry,
} from "../../../fixtures/settings-memory";
import { Mono, SaveFooter } from "../settings-layout";
import { useDraft } from "../use-draft";
import { MemoryTypeBadge } from "./memory-row";

export enum EMemorySheetMode {
  View = "view",
  Edit = "edit",
}

type MemoryDraft = Pick<MemoryEntry, "name" | "description" | "type" | "body">;

function isMemoryType(value: string): value is EMemoryType {
  return Object.values(EMemoryType).some((type) => type === value);
}

function MemoryView({
  entry,
  onEdit,
  onDelete,
}: {
  entry: MemoryEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <SheetHeader className="gap-2 pr-12">
        <div className="flex items-center gap-2">
          <MemoryTypeBadge type={entry.type} />
          <SheetTitle className="min-w-0 truncate">{entry.name}</SheetTitle>
        </div>
        <SheetDescription>{entry.description}</SheetDescription>
        <Mono className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span className="break-all">{entry.file}</span>
          <span aria-hidden>·</span>
          <span>recorded {entry.recorded}</span>
        </Mono>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <pre className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {entry.body}
        </pre>
      </div>
      <SheetFooter className="flex-row justify-between">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </SheetFooter>
    </>
  );
}

function MemoryEdit({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: MemoryEntry;
  onSave: (entry: MemoryEntry) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const draft = useDraft<MemoryDraft>({
    name: entry.name,
    description: entry.description,
    type: entry.type,
    body: entry.body,
  });
  const patch = (next: Partial<MemoryDraft>) => draft.setValue({ ...draft.value, ...next });

  const handleTypeChange = (next: string | null) => {
    if (next !== null && isMemoryType(next)) patch({ type: next });
  };
  const handleSave = () => {
    onSave({ ...entry, ...draft.value });
  };

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>Edit memory</SheetTitle>
        <SheetDescription>
          <Mono className="break-all">{entry.file}</Mono>
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="min-h-0 flex-1 overflow-y-auto px-4">
        <Field>
          <FieldLabel htmlFor="memory-name">Name</FieldLabel>
          <Input
            id="memory-name"
            value={draft.value.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-description">Description</FieldLabel>
          <Input
            id="memory-description"
            value={draft.value.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-type">Type</FieldLabel>
          <Select items={MEMORY_TYPE_OPTIONS} value={draft.value.type} onValueChange={handleTypeChange}>
            <SelectTrigger id="memory-type" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {MEMORY_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-body">Body</FieldLabel>
          <Textarea
            id="memory-body"
            spellCheck={false}
            className="field-sizing-fixed h-64 resize-y font-mono text-xs leading-relaxed"
            value={draft.value.body}
            onChange={(event) => patch({ body: event.target.value })}
          />
        </Field>
      </FieldGroup>
      <SheetFooter className="flex-row items-center justify-between">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <SaveFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={handleSave} />
        </div>
      </SheetFooter>
    </>
  );
}

export function MemorySheet({
  entry,
  mode,
  onModeChange,
  onClose,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry | null;
  mode: EMemorySheetMode;
  onModeChange: (mode: EMemorySheetMode) => void;
  onClose: () => void;
  onSave: (entry: MemoryEntry) => void;
  onDelete: (entry: MemoryEntry) => void;
}) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  const handleSave = (next: MemoryEntry) => {
    onSave(next);
    onModeChange(EMemorySheetMode.View);
  };
  return (
    <Sheet open={entry !== null} onOpenChange={handleOpenChange}>
      <SheetContent initialFocus={false} className="data-[side=right]:sm:max-w-xl">
        {entry && mode === EMemorySheetMode.Edit ? (
          <MemoryEdit
            key={entry.id}
            entry={entry}
            onSave={handleSave}
            onCancel={() => onModeChange(EMemorySheetMode.View)}
            onDelete={() => onDelete(entry)}
          />
        ) : null}
        {entry && mode === EMemorySheetMode.View ? (
          <MemoryView
            entry={entry}
            onEdit={() => onModeChange(EMemorySheetMode.Edit)}
            onDelete={() => onDelete(entry)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
