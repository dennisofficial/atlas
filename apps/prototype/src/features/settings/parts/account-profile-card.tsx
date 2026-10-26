import { useState, type ReactNode } from 'react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

import { CURRENT_USER } from '../fixtures/settings'
import { SettingsCard, Mono } from '../settings-layout'

type Profile = {
  name: string
  email: string
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function ProfileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 whitespace-nowrap">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="truncate text-sm">{children}</span>
    </div>
  )
}

function EditProfileDialog({
  profile,
  onSave,
}: {
  profile: Profile
  onSave: (next: Profile) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(profile)
  const dirty = draft.name.trim() !== profile.name || draft.email.trim() !== profile.email
  const valid = draft.name.trim().length > 0 && draft.email.includes('@')

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(profile)
    setOpen(next)
  }

  const handleSave = () => {
    onSave({ name: draft.name.trim(), email: draft.email.trim() })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name appears on threads and pull requests. Email is used for sign-in and
            notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" disabled={!dirty || !valid} onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountProfileCard() {
  const [profile, setProfile] = useState<Profile>({
    name: CURRENT_USER.name,
    email: CURRENT_USER.email,
  })

  return (
    <SettingsCard>
      <div className="flex items-center gap-4 px-4 py-4">
        <Avatar size="lg" className="size-10">
          <AvatarFallback className="text-sm">{initialsOf(profile.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-5">
          <ProfileField label="Name">{profile.name}</ProfileField>
          <ProfileField label="Email">{profile.email}</ProfileField>
          <ProfileField label="GitHub">
            <Mono>{CURRENT_USER.githubLogin}</Mono>
          </ProfileField>
          <ProfileField label="Threads">
            <Mono>{CURRENT_USER.threadCount.toLocaleString('en-US')}</Mono>
          </ProfileField>
          <ProfileField label="Member since">{CURRENT_USER.joined}</ProfileField>
        </div>
        <EditProfileDialog profile={profile} onSave={setProfile} />
      </div>
    </SettingsCard>
  )
}
