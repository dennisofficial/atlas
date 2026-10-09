import { ENVELOPE_CONTEXT_TAG, systemContext } from './envelope'

export const wrapInSystemReminder = (text: string): string =>
  `<${ENVELOPE_CONTEXT_TAG}>\n${text}\n</${ENVELOPE_CONTEXT_TAG}>`

export function contextBlock({ slot, key, content }: { slot: string; key: string; content: string }): string {
  return systemContext({ slot, key, content })
}
