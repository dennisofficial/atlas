import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'
import type { ReactNode } from 'react'

export default function ProtoLayout({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}
