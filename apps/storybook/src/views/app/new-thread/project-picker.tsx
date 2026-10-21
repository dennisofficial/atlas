import { FolderGit2Icon, FolderXIcon } from "lucide-react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@dltech/atlas-ui/components/combobox";
import { InputGroupButton } from "@dltech/atlas-ui/components/input-group";

import { PROJECTS, type AppProject } from "../../../fixtures/app";
import { NO_PROJECT_LABEL } from "./new-thread-data";

export interface ProjectPickerProps {
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
}

export function projectLabel(project: AppProject): string {
  return `${project.owner}/${project.name}`;
}

const LABELS = [NO_PROJECT_LABEL, ...PROJECTS.map(projectLabel)];

export function ProjectPicker({ projectId, onProjectChange }: ProjectPickerProps) {
  const selected = PROJECTS.find((project) => project.id === projectId);
  const value = selected ? projectLabel(selected) : NO_PROJECT_LABEL;
  const TriggerIcon = selected ? FolderGit2Icon : FolderXIcon;

  const handleValueChange = (next: string | null) => {
    if (next === NO_PROJECT_LABEL) return onProjectChange(null);
    const match = PROJECTS.find((project) => projectLabel(project) === next);
    if (match) onProjectChange(match.id);
  };

  return (
    <Combobox items={LABELS} value={value} onValueChange={handleValueChange}>
      <ComboboxTrigger
        render={
          <InputGroupButton
            size="sm"
            aria-label="Project"
            className="max-w-56 min-w-0 font-mono text-xs"
          />
        }
      >
        <TriggerIcon />
        <span className="truncate">
          <ComboboxValue>{(label: string) => label}</ComboboxValue>
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="w-64">
        <ComboboxInput showTrigger={false} placeholder="Search projects" />
        <ComboboxEmpty>No projects found.</ComboboxEmpty>
        <ComboboxList>
          {(label: string) => (
            <ComboboxItem
              key={label}
              value={label}
              className={label === NO_PROJECT_LABEL ? "text-xs" : "font-mono text-xs"}
            >
              {label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
