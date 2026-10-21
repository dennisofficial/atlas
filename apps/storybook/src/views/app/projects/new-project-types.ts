export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_ADDITIONAL_REPOS = 10;

export enum ENewProjectStep {
  Source = "Source",
  Repository = "Repository",
  Details = "Details",
}

export enum EProjectSource {
  Existing = "Existing",
  NewRepo = "NewRepo",
  NoRepo = "NoRepo",
}

export interface ProjectDraft {
  source: EProjectSource;
  repo: string | null;
  repoQuery: string;
  branch: string | null;
  newRepoOwner: string;
  newRepoName: string;
  newRepoPrivate: boolean;
  name: string;
  nameTouched: boolean;
  ownerId: string;
  description: string;
  additionalRepos: string[];
}

export interface NewProjectSeed {
  step: ENewProjectStep;
  draft?: Partial<ProjectDraft>;
  pickerOpen?: boolean;
  githubConnected?: boolean;
}

export type DraftPatch = (patch: Partial<ProjectDraft>) => void;
