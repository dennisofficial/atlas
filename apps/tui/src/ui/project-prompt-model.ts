import { GIT_BRANCH_PATTERN, MAX_PROJECT_NAME_LENGTH, type Project } from '@dltech/atlas-wire'

export const NO_WORKSPACE_LABEL = 'No workspace'

export enum EProjectPrompt {
  Pick = 'pick',
  Create = 'create',
}

export enum EProjectField {
  Name = 'name',
  Base = 'base',
}

export enum EProjectAnswer {
  Pick = 'pick',
  Create = 'create',
  Cancelled = 'cancelled',
}

export type ProjectRequest =
  | { mode: EProjectPrompt.Pick; projects: readonly Project[] }
  | { mode: EProjectPrompt.Create; repo: string; name: string; baseBranch: string }

export type ProjectAnswer =
  | { kind: EProjectAnswer.Pick; projectId: string | null }
  | { kind: EProjectAnswer.Create; name: string; baseBranch: string | null }
  | { kind: EProjectAnswer.Cancelled }

export type ProjectRow = {
  projectId: string | null
  name: string
  repo: string | null
  updatedAt: string | null
}

export type PickState = {
  mode: EProjectPrompt.Pick
  rows: readonly ProjectRow[]
  index: number
}

export type CreateState = {
  mode: EProjectPrompt.Create
  repo: string
  name: string
  base: string
  field: EProjectField
  problem: string | null
}

export type ProjectPromptState = PickState | CreateState

export const NAME_REQUIRED = 'give the project a name'

export const NAME_TOO_LONG = `keep the name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer`

export const BRANCH_INVALID = 'that is not a valid branch name'

const newestFirst = (a: Project, b: Project): number =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0

export function projectRows(projects: readonly Project[]): readonly ProjectRow[] {
  const rows = [...projects]
    .sort(newestFirst)
    .map(
      (project): ProjectRow => ({
        projectId: project.id,
        name: project.name,
        repo: project.repo,
        updatedAt: project.updatedAt,
      }),
    )
  return [...rows, { projectId: null, name: NO_WORKSPACE_LABEL, repo: null, updatedAt: null }]
}

export function openProjectPrompt(request: ProjectRequest): ProjectPromptState {
  if (request.mode === EProjectPrompt.Pick) {
    return { mode: EProjectPrompt.Pick, rows: projectRows(request.projects), index: 0 }
  }
  return {
    mode: EProjectPrompt.Create,
    repo: request.repo,
    name: request.name,
    base: request.baseBranch,
    field: EProjectField.Name,
    problem: null,
  }
}

export function moveProjectRow(args: { state: PickState; delta: number }): PickState {
  const last = args.state.rows.length - 1
  return { ...args.state, index: Math.min(last, Math.max(0, args.state.index + args.delta)) }
}

export const pickAnswer = (args: { state: PickState; index: number }): ProjectAnswer | null => {
  const row = args.state.rows[args.index]
  return row === undefined ? null : { kind: EProjectAnswer.Pick, projectId: row.projectId }
}

export const switchField = (state: CreateState): CreateState => ({
  ...state,
  field: state.field === EProjectField.Name ? EProjectField.Base : EProjectField.Name,
})

export const focusField = (args: { state: CreateState; field: EProjectField }): CreateState => ({
  ...args.state,
  field: args.field,
})

export function editField(args: {
  state: CreateState
  edit: (value: string) => string
}): CreateState {
  const { state } = args
  return state.field === EProjectField.Name
    ? { ...state, name: args.edit(state.name), problem: null }
    : { ...state, base: args.edit(state.base), problem: null }
}

export const appended =
  (text: string) =>
  (value: string): string =>
    `${value}${text}`

export const withoutLast = (value: string): string => [...value].slice(0, -1).join('')

export function problemOf(state: CreateState): string | null {
  const name = state.name.trim()
  if (name.length === 0) return NAME_REQUIRED
  if (name.length > MAX_PROJECT_NAME_LENGTH) return NAME_TOO_LONG
  const base = state.base.trim()
  return base.length > 0 && !GIT_BRANCH_PATTERN.test(base) ? BRANCH_INVALID : null
}

export function createAnswer(state: CreateState): ProjectAnswer {
  const base = state.base.trim()
  return {
    kind: EProjectAnswer.Create,
    name: state.name.trim(),
    baseBranch: base.length === 0 ? null : base,
  }
}

export const PROJECT_LIST_ROWS = 10

export function rowWindow(args: { count: number; index: number; size: number }): {
  start: number
  end: number
} {
  const start = Math.max(
    0,
    Math.min(args.index - Math.floor(args.size / 2), args.count - args.size),
  )
  return { start, end: Math.min(args.count, start + args.size) }
}
