'use client'

import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'

import { ERenderKind } from './context-model'
import { HtmlFrame } from './html-view'

export function RenderedFile(props: { kind: ERenderKind; content: string; path: string }) {
  const { kind, content, path } = props
  if (kind === ERenderKind.Html) return <HtmlFrame html={content} title={path} />
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <MessageResponse>{content}</MessageResponse>
      </div>
    </div>
  )
}
