import { Avatar, AvatarFallback, AvatarImage } from '@dltech/atlas-ui/components/avatar'

export function RepoAvatar({
  owner,
  avatarUrl,
  size = 'default',
}: {
  owner: string
  avatarUrl: string | null
  size?: 'default' | 'sm' | 'lg'
}) {
  return (
    <Avatar size={size}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="font-medium uppercase">{owner.slice(0, 1)}</AvatarFallback>
    </Avatar>
  )
}
