export const localSummary = {
  threadId: 'brn_1',
  title: 'Host title',
  projectId: null,
  head: 3,
  readSeq: 1,
  model: 'provider/model',
  effort: 'high',
  createdAt: '2026-10-29T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
  status: {
    working: false,
    awaiting: null,
    lastOutcome: 'completed',
    podState: 'parked',
    lastAssistantSeq: 3,
    readSeq: 1,
  },
}

export const localEvent = (seq: number) => ({
  id: `event_${seq}`,
  threadId: 'brn_1',
  seq,
  runId: 'run',
  depth: 0,
  at: '2026-10-29T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
})
