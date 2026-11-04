'use client'

import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'

import { ERenderKind } from './context-model'

export function RenderedFile(props: { kind: ERenderKind; content: string; path: string }) {
  const { kind, content, path } = props
  if (kind === ERenderKind.Html) {
    return (
      <iframe
        srcDoc={content}
        title={path}
        sandbox="allow-scripts"
        className="h-full w-full border-0 bg-white"
      />
    )
  }
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <MessageResponse>{content}</MessageResponse>
      </div>
    </div>
  )
}
