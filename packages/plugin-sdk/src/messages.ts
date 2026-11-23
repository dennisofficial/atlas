export const PARENT_ADDRESS = 'parent'

export type MessageSent = { delivered: true; to: string; queued: boolean } | { refused: string }

export type PodMessages = {
  send(args: { to: string; text: string }): Promise<MessageSent>
}

export const EMPTY_MESSAGES: PodMessages = Object.freeze({
  send: async () => ({ refused: 'this session cannot message other agents' }),
})
