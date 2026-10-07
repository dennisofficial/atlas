import { extend } from '@opentui/react'

import { TerminalImageRenderable } from './terminal-image'

export class ViewerImageRenderable extends TerminalImageRenderable {}

declare module '@opentui/react' {
  interface OpenTUIComponents {
    'viewer-image': typeof ViewerImageRenderable
  }
}

extend({ 'viewer-image': ViewerImageRenderable })
