import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#components/select'
import type { ChangeScopeOption } from './changes-types'

function scopeLabel(scope: ChangeScopeOption): string {
  return scope.detail ? `${scope.label} · ${scope.detail}` : scope.label
}

interface ScopeSwitcherProps {
  scopes: ChangeScopeOption[]
  scope: string
  onScopeChange?: (id: string) => void
}

export function ScopeSwitcher({ scopes, scope, onScopeChange }: ScopeSwitcherProps) {
  const items = scopes.map((option) => ({
    value: option.id,
    label: scopeLabel(option),
  }))
  const handleValueChange = (value: string | null) => {
    if (value !== null) onScopeChange?.(value)
  }

  return (
    <Select items={items} value={scope} onValueChange={handleValueChange}>
      <SelectTrigger
        size="sm"
        variant="ghost"
        aria-label="Change scope"
        className="w-full min-w-0 text-xs text-muted-foreground"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="top" alignItemWithTrigger={false} className="min-w-72">
        {scopes.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="text-foreground">{option.label}</span>
            {option.detail ? <span className="text-muted-foreground">{option.detail}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
