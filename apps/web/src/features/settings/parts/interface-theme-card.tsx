import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@dltech/atlas-ui/components/field'
import { RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'

import { ETheme } from '../fixtures/settings-interface'

const THEME_LABELS: Record<ETheme, { title: string; hint: string }> = {
  [ETheme.Dark]: { title: 'Dark', hint: 'Easy on the eyes' },
  [ETheme.Light]: { title: 'Light', hint: 'High daylight contrast' },
  [ETheme.System]: { title: 'System', hint: 'Follow your OS' },
}

function MiniApp() {
  return (
    <div className="flex h-full overflow-hidden rounded-md border bg-background">
      <div className="flex w-1/4 flex-col gap-1.5 border-r bg-sidebar p-1.5">
        <div className="h-1.5 w-3/4 rounded-full bg-muted" />
        <div className="h-1.5 w-full rounded-full bg-muted" />
        <div className="h-1.5 w-2/3 rounded-full bg-muted" />
      </div>
      <div className="flex flex-1 flex-col justify-between p-2">
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 w-1/2 rounded-full bg-muted" />
          <div className="h-1.5 w-5/6 rounded-full bg-muted" />
          <div className="h-1.5 w-2/3 rounded-full bg-muted" />
        </div>
        <div className="h-3 rounded-sm border bg-muted" />
      </div>
    </div>
  )
}

function ThemePreview({ theme }: { theme: ETheme }) {
  if (theme === ETheme.Light) {
    return (
      <div className="light h-full">
        <MiniApp />
      </div>
    )
  }
  if (theme === ETheme.Dark) return <MiniApp />
  return (
    <div className="relative h-full">
      <MiniApp />
      <div className="light absolute inset-0 [clip-path:polygon(50%_0,100%_0,100%_100%,50%_100%)]">
        <MiniApp />
      </div>
    </div>
  )
}

export function ThemeCard({ theme }: { theme: ETheme }) {
  const label = THEME_LABELS[theme]
  const id = `theme-${theme}`
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <div className="mb-2 h-24">
            <ThemePreview theme={theme} />
          </div>
          <FieldTitle>{label.title}</FieldTitle>
          <FieldDescription>{label.hint}</FieldDescription>
        </FieldContent>
        <RadioGroupItem value={theme} id={id} aria-label={label.title} />
      </Field>
    </FieldLabel>
  )
}
