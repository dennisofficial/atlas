'use client'

import { useState, type ReactNode } from 'react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import { CardRow } from '@dltech/atlas-ui/components/card'
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

import { initialsOf } from '../session/initials'
import { SettingsCard, Mono } from '../settings-layout'

type Profile = {
  name: string
  email: string
}

export const PROFILE_ROW_CLASS = 'items-start lg:flex-row lg:items-center'
export const PROFILE_GRID_CLASS =
  'grid w-full min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 lg:flex lg:flex-1 lg:items-start lg:justify-between lg:gap-5'

const NOT_AVAILABLE = '—'

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
  saving,
  onSave,
}: {
  profile: Profile
  saving: boolean
  onSave: (name: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(profile)
  const dirty = draft.name.trim() !== profile.name
  const valid = draft.name.trim().length > 0 && !saving

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(profile)
    setOpen(next)
  }

  const handleSave = async () => {
    if (await onSave(draft.name.trim())) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name appears on threads and pull requests. Email is used for sign-in and cannot be
            changed here.
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
            <Input id="profile-email" type="email" readOnly value={draft.email} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" disabled={!dirty || !valid} onClick={() => void handleSave()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountProfileCard({
  profile,
  githubLogin,
  memberSince,
  saving,
  onSave,
}: {
  profile: Profile
  githubLogin: string | null
  memberSince: string | null
  saving: boolean
  onSave: (name: string) => Promise<boolean>
}) {
  return (
    <SettingsCard>
      <CardRow className={PROFILE_ROW_CLASS}>
        <Avatar size="lg">
          <AvatarFallback>{initialsOf(profile.name)}</AvatarFallback>
        </Avatar>
        <div className={PROFILE_GRID_CLASS}>
          <ProfileField label="Name">{profile.name}</ProfileField>
          <ProfileField label="Email">{profile.email}</ProfileField>
          <ProfileField label="GitHub">
            <Mono>{githubLogin ?? 'Not connected'}</Mono>
          </ProfileField>
          <ProfileField label="Threads">
            <Mono>{NOT_AVAILABLE}</Mono>
          </ProfileField>
          <ProfileField label="Member since">{memberSince ?? NOT_AVAILABLE}</ProfileField>
        </div>
        <EditProfileDialog profile={profile} saving={saving} onSave={onSave} />
      </CardRow>
    </SettingsCard>
  )
}
