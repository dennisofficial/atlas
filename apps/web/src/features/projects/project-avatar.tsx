import { Avatar, AvatarFallback, AvatarImage } from '@dltech/atlas-ui/components/avatar'
import { cn } from '@dltech/atlas-ui/lib/utils'

const AVATAR_PIXELS = 80

export function ownerAvatarUrlOf(repo: string | null): string | null {
  const owner = repo?.split('/')[0]?.trim()
  if (!owner) return null
  return `https://github.com/${encodeURIComponent(owner)}.png?size=${AVATAR_PIXELS}`
}

export function ProjectAvatar({
  name,
  repo,
  size = 'default',
  className,
}: {
  name: string
  repo: string | null
  size?: 'default' | 'xs' | 'sm' | 'lg'
  className?: string
}) {
  const src = ownerAvatarUrlOf(repo)
  return (
    <Avatar size={size} aria-hidden className={cn('rounded-md after:rounded-md', className)}>
      {src ? <AvatarImage src={src} alt="" className="rounded-md" /> : null}
      <AvatarFallback className="rounded-md font-semibold text-foreground uppercase">
        {name.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  )
}
