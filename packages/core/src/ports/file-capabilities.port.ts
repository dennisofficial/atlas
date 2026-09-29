import type { ModelCard } from '../models/card'

/**
 * models.dev publishes input modalities per model, but the catalogue does not read them yet, so a
 * card is trusted to take file parts unless a future generator marks it text-only. Every provider
 * path Atlas ships today consumes one: Anthropic and the responses API natively, chat-completions
 * through the hoist into a user message.
 */
export const acceptsFileParts = (card: Pick<ModelCard, 'api'> | undefined): boolean => true

export abstract class FileCapabilitiesPort {
  abstract acceptsFiles(): boolean
}
