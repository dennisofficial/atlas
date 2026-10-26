import { SquareTerminalIcon } from 'lucide-react'

import { TabPlaceholder } from './tab-placeholder'

export function TerminalTab() {
  return (
    <TabPlaceholder
      icon={<SquareTerminalIcon />}
      title="Terminal isn't available yet"
      description="A shell inside the thread's sandbox will open here."
    />
  )
}
