import type { TerminalStreamAttachInput } from '@dltech/atlas-protocol'

import { api } from '@/lib/api-client'

import {
  createTerminalTransport,
  type TerminalApi,
  type TerminalStreamHandlers,
  type TerminalTransport,
  type TerminalTransportArgs,
} from './terminal-transport'

const webTerminalApi: TerminalApi = {
  list: (input) => api.terminal.list.query(input),
  open: (input) => api.terminal.open.mutate(input),
  rename: (input) => api.terminal.rename.mutate(input),
  write: (input) => api.terminal.write.mutate(input),
  resize: (input) => api.terminal.resize.mutate(input),
  close: (input) => api.terminal.close.mutate(input),
  read: (input) => api.terminal.read.query(input),
}

const subscribe = (
  input: TerminalStreamAttachInput,
  handlers: TerminalStreamHandlers,
): { unsubscribe: () => void } => api.terminalStream.attach.subscribe(input, handlers)

export type TerminalTransportOf = (
  args: Omit<TerminalTransportArgs, 'api' | 'subscribe'>,
) => TerminalTransport

export const terminalTransport: TerminalTransportOf = (args) =>
  createTerminalTransport({ ...args, api: webTerminalApi, subscribe })
