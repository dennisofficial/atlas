import { AtlasMark } from '../shell/atlas-mark'

export function AuthBrand() {
  return (
    <div className="flex items-center gap-2">
      <AtlasMark className="size-6 text-primary" />
      <span className="font-display text-lg font-semibold text-foreground">Atlas</span>
      <span className="text-xs text-muted-foreground">Cloud</span>
    </div>
  )
}
