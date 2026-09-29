import {
  acceptsFileParts,
  FileCapabilitiesPort,
  type ModelCard,
} from '@dltech/atlas-core'

import type { ModelCardSource } from '../../model/ai-sdk-model-port'

const cardOf = (source: ModelCardSource | undefined): ModelCard | undefined =>
  typeof source === 'function' ? source() : source

export class CardFileCapabilities extends FileCapabilitiesPort {
  private readonly card: ModelCardSource | undefined

  constructor(args: { card?: ModelCardSource | undefined }) {
    super()
    this.card = args.card
  }

  override acceptsFiles(): boolean {
    return acceptsFileParts(cardOf(this.card))
  }
}
