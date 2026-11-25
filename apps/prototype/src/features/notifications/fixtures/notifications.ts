export type InAppNotice = { sessionId: string; title: string; body: string }

export const IN_APP_NOTICE_FIXTURES: readonly InAppNotice[] = [
  { sessionId: 'thr-ui-rebase', title: 'Fix the sidebar', body: 'Finished' },
  { sessionId: 'thr-snapshots', title: 'Snapshot tokens', body: 'Needs your answer' },
]
