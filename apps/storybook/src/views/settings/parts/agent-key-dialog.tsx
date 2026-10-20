import { useState } from "react";

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

export function KeyDialog({
  providerName,
  placeholder,
  triggerLabel,
  primary = false,
  onSave,
}: {
  providerName: string;
  placeholder: string;
  triggerLabel: string;
  primary?: boolean;
  onSave: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setValue("");
  };
  const handleSave = () => {
    onSave(trimmed);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant={primary ? "default" : "outline"} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{triggerLabel} · {providerName}</DialogTitle>
          <DialogDescription>
            Stored encrypted and only sent to {providerName}. It is never shown again after saving.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`key-${providerName}`}>API key</Label>
          <Input
            id={`key-${providerName}`}
            type="password"
            autoComplete="off"
            placeholder={placeholder}
            className="font-mono"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={trimmed.length === 0} onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
