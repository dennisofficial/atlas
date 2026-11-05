import type { StreamServerMessage, StreamStepKey } from '@dltech/atlas-protocol'

export type ClientView = { key: StreamStepKey | undefined; text: string }

export const clientViewOf = (sent: readonly StreamServerMessage[]): ClientView => {
  const view: ClientView = { key: undefined, text: '' }
  for (const message of sent) {
    if (message.type === 'overlay') {
      view.key = message.key
      view.text = message.blocks[0]?.text ?? ''
    }
    if (message.type === 'overlay-clear') {
      view.key = undefined
      view.text = ''
    }
    if (message.type === 'delta') view.text = view.text.slice(0, message.from) + message.text
    if (message.type === 'frame' && message.frame.type === 'step-end') view.key = undefined
  }
  return view
}
