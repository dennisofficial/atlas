const serverSentEvents = (events: readonly Record<string, unknown>[]): string =>
  events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('')

const CREATED = {
  type: 'response.created',
  response: { id: 'resp_stub', created_at: 1_767_225_600, model: 'gpt-5.1-codex' },
}

const completed = (extra: Record<string, unknown> = {}) => ({
  type: 'response.completed',
  response: {
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    ...extra,
  },
})

const messageEvents = ({ id, text }: { id: string; text: string }) => [
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id } },
  { type: 'response.output_text.delta', item_id: id, output_index: 0, delta: text },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id } },
]

export const streamedResponse = (text = 'pong'): string =>
  serverSentEvents([CREATED, ...messageEvents({ id: 'msg_stub', text }), completed()])

export const streamedReasoningThenResponse = (text = 'pong'): string =>
  serverSentEvents([
    CREATED,
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'reasoning', id: 'rs_stub', encrypted_content: null },
    },
    {
      type: 'response.reasoning_summary_part.added',
      item_id: 'rs_stub',
      output_index: 0,
      summary_index: 0,
    },
    {
      type: 'response.reasoning_summary_text.delta',
      item_id: 'rs_stub',
      output_index: 0,
      summary_index: 0,
      delta: 'thinking it over',
    },
    {
      type: 'response.reasoning_summary_part.done',
      item_id: 'rs_stub',
      output_index: 0,
      summary_index: 0,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'reasoning', id: 'rs_stub', encrypted_content: 'enc_stub' },
    },
    ...messageEvents({ id: 'msg_stub', text }),
    completed(),
  ])

export const streamedFailure = (): string =>
  serverSentEvents([
    CREATED,
    { type: 'error', code: 'server_error', message: 'upstream exploded', param: null },
  ])
