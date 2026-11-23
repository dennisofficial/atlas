export enum ECallKind {
  Shell = 'shell',
  Read = 'read',
  Search = 'search',
  Edit = 'edit',
  Web = 'web',
  Skill = 'skill',
  Agent = 'agent',
  Plan = 'plan',
  Other = 'other',
}

const KIND_OF_TOOL: Record<string, ECallKind> = {
  read: ECallKind.Read,
  read_image: ECallKind.Read,
  grep: ECallKind.Search,
  glob: ECallKind.Search,
  edit: ECallKind.Edit,
  multi_edit: ECallKind.Edit,
  write: ECallKind.Edit,
  web_fetch: ECallKind.Web,
  web_search: ECallKind.Web,
  skill: ECallKind.Skill,
  bash: ECallKind.Shell,
  task_write: ECallKind.Plan,
}

const AGENT_TOOL_PREFIX = 'agent_'

export const callKindOf = (name: string): ECallKind => {
  const named = KIND_OF_TOOL[name]
  if (named !== undefined) return named
  if (name.startsWith(AGENT_TOOL_PREFIX)) return ECallKind.Agent
  return ECallKind.Other
}
