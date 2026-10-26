import type { ReactNode } from 'react'

import { TooltipProvider } from '@/proto/ui/tooltip'

import '@/proto/proto-chrome.css'

export default function ProtoLayout({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}
