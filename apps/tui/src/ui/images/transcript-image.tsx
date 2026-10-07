import { extend } from '@opentui/react'

import { TerminalImageRenderable } from './terminal-image'

export class TranscriptImageRenderable extends TerminalImageRenderable {}

declare module '@opentui/react' {
  interface OpenTUIComponents {
    'transcript-image': typeof TranscriptImageRenderable
  }
}

extend({ 'transcript-image': TranscriptImageRenderable })
