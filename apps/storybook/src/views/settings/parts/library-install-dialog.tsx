import { useState, type ReactNode } from "react";

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
import { Input } from "@dltech/atlas-ui/components/input";
import { Label } from "@dltech/atlas-ui/components/label";
import { Textarea } from "@dltech/atlas-ui/components/textarea";

function InstallForm({
  title,
  description,
  label,
  placeholder,
  multiline,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  description: ReactNode;
  label: string;
  placeholder: string;
  multiline: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="library-install-input">{label}</Label>
        {multiline ? (
          <Textarea
            id="library-install-input"
            className="min-h-32 font-mono text-xs"
            placeholder={placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <Input
            id="library-install-input"
            className="font-mono text-xs"
            placeholder={placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={trimmed.length === 0} onClick={() => onSubmit(trimmed)}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function LibraryInstallDialog({
  triggerLabel,
  triggerIcon,
  triggerVariant = "default",
  title,
  description,
  label,
  placeholder,
  multiline = false,
  submitLabel,
  onSubmit,
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerVariant?: "default" | "outline";
  title: string;
  description: ReactNode;
  label: string;
  placeholder: string;
  multiline?: boolean;
  submitLabel: string;
  onSubmit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerIcon}
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <InstallForm
          title={title}
          description={description}
          label={label}
          placeholder={placeholder}
          multiline={multiline}
          submitLabel={submitLabel}
          onCancel={() => setOpen(false)}
          onSubmit={(value) => {
            onSubmit(value);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
