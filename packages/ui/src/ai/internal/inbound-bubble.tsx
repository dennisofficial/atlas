import type { ReactNode } from 'react'
import { MessageSquareShareIcon } from 'lucide-react'

import { Bubble, BubbleContent } from '#components/bubble'

import { CollapsibleBody } from './collapsible-body'

export function InboundBubble({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <Bubble variant="outline" data-inbound="">
      <BubbleContent className="flex flex-col gap-1.5 text-pretty">
        <span
          data-slot="message-caption"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <MessageSquareShareIcon aria-hidden className="size-3.5" />
          {caption}
        </span>
        <CollapsibleBody>{children}</CollapsibleBody>
      </BubbleContent>
    </Bubble>
  )
}
