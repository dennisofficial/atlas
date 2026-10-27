import { PlusIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Tabs, TabsList, TabsTrigger } from '#components/tabs'

export interface TerminalTab {
  id: string
  label: string
}

export interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeId: string
  onActiveChange: (id: string) => void
  onNew?: () => void
}

export function TerminalTabs({ tabs, activeId, onActiveChange, onNew }: TerminalTabsProps) {
  const handleValueChange = (value: unknown) => {
    if (typeof value === 'string') onActiveChange(value)
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-2">
      <Tabs value={activeId} onValueChange={handleValueChange} className="min-w-0 flex-1">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="flex-none text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {onNew ? (
        <Button size="xs" variant="ghost" onClick={onNew}>
          <PlusIcon data-icon="inline-start" />
          New terminal
        </Button>
      ) : null}
    </div>
  )
}
