import type { LucideIcon } from "lucide-react";
import {
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";

export enum EToolKind {
  Shell = "shell",
  Read = "read",
  Search = "search",
  Edit = "edit",
  Web = "web",
  Skill = "skill",
}

export interface ToolKindAppearance {
  icon: LucideIcon;
  ask: string;
  running: string;
  done: string;
  error: string;
}

export const TOOL_KINDS: Record<EToolKind, ToolKindAppearance> = {
  [EToolKind.Shell]: {
    icon: TerminalIcon,
    ask: "Run",
    running: "Running",
    done: "Ran",
    error: "Failed to run",
  },
  [EToolKind.Read]: {
    icon: FileTextIcon,
    ask: "Read",
    running: "Reading",
    done: "Read",
    error: "Failed to read",
  },
  [EToolKind.Search]: {
    icon: SearchIcon,
    ask: "Search for",
    running: "Searching for",
    done: "Searched for",
    error: "Failed to search for",
  },
  [EToolKind.Edit]: {
    icon: FilePenIcon,
    ask: "Edit",
    running: "Editing",
    done: "Edited",
    error: "Failed to edit",
  },
  [EToolKind.Web]: {
    icon: GlobeIcon,
    ask: "Fetch",
    running: "Fetching",
    done: "Fetched",
    error: "Failed to fetch",
  },
  [EToolKind.Skill]: {
    icon: SparklesIcon,
    ask: "Use skill",
    running: "Using skill",
    done: "Used skill",
    error: "Failed to use skill",
  },
};
