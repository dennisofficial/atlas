import { ChevronRightIcon, FolderGit2Icon, FolderXIcon, GitBranchPlusIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EProjectSource } from "./new-project-types";

interface SourceOption {
  source: EProjectSource;
  icon: LucideIcon;
  title: string;
  description: string;
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    source: EProjectSource.Existing,
    icon: FolderGit2Icon,
    title: "Use an existing repository",
    description: "Pick one of your GitHub repositories, or paste its URL.",
  },
  {
    source: EProjectSource.NewRepo,
    icon: GitBranchPlusIcon,
    title: "Create a new GitHub repository",
    description: "Atlas creates an empty repository on your GitHub account.",
  },
  {
    source: EProjectSource.NoRepo,
    icon: FolderXIcon,
    title: "No repository",
    description: "Start with an empty workspace. Add a repository later.",
  },
];

export function SourceStep({ onSelect }: { onSelect: (source: EProjectSource) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {SOURCE_OPTIONS.map(({ source, icon: Icon, title, description }) => {
        const handleClick = () => onSelect(source);
        return (
          <li key={source}>
            <button
              type="button"
              onClick={handleClick}
              className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
              >
                <Icon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </span>
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
