import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

export const SETTLED_TAIL = 2
export const FOLD_MIN = 2

export enum ETodoStatus {
  Done = 'done',
  Running = 'running',
  Pending = 'pending',
}

export interface TodoTask {
  id: string
  text: string
  activeForm?: string
  status: ETodoStatus
}

export function todoLabelOf(task: TodoTask): string {
  if (task.status !== ETodoStatus.Running) return task.text
  return task.activeForm ?? task.text
}

export function todoCountOf(tasks: TodoTask[]): string {
  return `${tasks.filter((task) => task.status === ETodoStatus.Done).length}/${tasks.length}`
}

export function foldTodos({ tasks, expanded }: { tasks: TodoTask[]; expanded: boolean }) {
  const done = tasks.filter((task) => task.status === ETodoStatus.Done)
  const folded = done.length - SETTLED_TAIL
  if (folded < FOLD_MIN) return { shown: tasks, hidden: 0 }
  const active = tasks.filter((task) => task.status !== ETodoStatus.Done)
  return {
    shown: [...(expanded ? done.slice(0, folded) : []), ...done.slice(folded), ...active],
    hidden: folded,
  }
}

export function todoDoneLabelOf({ hidden, expanded }: { hidden: number; expanded: boolean }) {
  return expanded ? 'Show fewer' : `${hidden} earlier done`
}

export function earlierLabelOf({ hidden, failed }: { hidden: number; failed: boolean }): string {
  return `+${hidden} earlier${failed ? ' · one failed' : ''}`
}

export interface CrewRow {
  id: string
  title: string
  subtitle?: string
  display: EAgentDisplay
}

export function isWorking(display: EAgentDisplay): boolean {
  return (
    display === EAgentDisplay.Running ||
    display === EAgentDisplay.NeedsApproval ||
    display === EAgentDisplay.StartingSandbox
  )
}

function isSettled(display: EAgentDisplay): boolean {
  return display === EAgentDisplay.Done || display === EAgentDisplay.Failed
}

export function foldCrew({ rows, expanded }: { rows: CrewRow[]; expanded: boolean }) {
  const settled = rows.filter((row) => isSettled(row.display))
  const beyondTail = settled.length - SETTLED_TAIL
  if (beyondTail < FOLD_MIN) return { shown: rows, collapsed: 0, collapsedFailed: false }
  const collapsed = settled.slice(0, beyondTail)
  const keys = new Set(collapsed.map((row) => row.id))
  return {
    shown: expanded ? rows : rows.filter((row) => !keys.has(row.id)),
    collapsed: collapsed.length,
    collapsedFailed: collapsed.some((row) => row.display === EAgentDisplay.Failed),
  }
}

export function settledLabelOf({
  collapsed,
  expanded,
  failed,
}: {
  collapsed: number
  expanded: boolean
  failed: boolean
}): string {
  return expanded ? 'Show fewer' : `${collapsed} settled${failed ? ' · one failed' : ''}`
}

export interface ContextNode {
  name: string
  path: string
  children?: ContextNode[]
  content?: string
}

export interface ContextRow {
  path: string
  name: string
  depth: number
  isDirectory: boolean
  open: boolean
}

export function contextRowsOf({
  nodes,
  open,
  depth = 0,
}: {
  nodes: ContextNode[]
  open: string[]
  depth?: number
}): ContextRow[] {
  return nodes.flatMap((node) => {
    const isDirectory = node.children !== undefined
    const isOpen = isDirectory && open.includes(node.path)
    const row = { path: node.path, name: node.name, depth, isDirectory, open: isOpen }
    if (!isOpen) return [row]
    return [row, ...contextRowsOf({ nodes: node.children ?? [], open, depth: depth + 1 })]
  })
}

export function findContextNode(nodes: ContextNode[], path: string): ContextNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const inner = findContextNode(node.children ?? [], path)
    if (inner) return inner
  }
  return undefined
}
