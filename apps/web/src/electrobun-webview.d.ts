import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'electrobun-webview': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        renderer?: 'cef' | 'native'
        masks?: string
        preload?: string
      }
    }
  }
}
