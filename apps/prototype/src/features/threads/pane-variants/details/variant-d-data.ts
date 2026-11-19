import type { PanePr } from './details-data'

export const SESSION_TITLE = 'Rebase ui on shadcn base-nova'
export const SESSION_STATUS = 'Running'
export const SESSION_ELAPSED = '1h 12m'

const PR_DIFF: Record<number, { added: number; removed: number }> = {
  1469: { added: 134, removed: 45 },
  1472: { added: 89, removed: 33 },
  1467: { added: 420, removed: 96 },
}

const REVIEW_NOTE: Record<number, string> = {
  1469: 'review required',
  1472: 'changes requested',
  1467: 'merged',
}

export function prDiffOf(pr: PanePr): { added: number; removed: number } {
  return PR_DIFF[pr.number] ?? { added: 0, removed: 0 }
}

export function reviewNoteOf(pr: PanePr): string {
  return REVIEW_NOTE[pr.number] ?? pr.review
}

export function ciLabelOf(pr: PanePr): string {
  const checks = pr.passing + pr.failing + pr.running
  return `CI ${pr.passing}/${checks}`
}

export function contextSizeOf(detail: string): string {
  return detail.match(/\d+\s+(?:lines|entries?)/)?.[0] ?? detail
}
