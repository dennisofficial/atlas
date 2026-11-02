import { Item, ItemActions, ItemContent, ItemMedia } from '@dltech/atlas-ui/components/item'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { AuthButtonSkeleton, AuthHeadingSkeleton, AuthTextLineSkeleton } from './auth-skeletons'

function CopyRowSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-40" />
      </div>
      <Item variant="outline" size="sm" className="flex-nowrap">
        <ItemContent className="min-w-0">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-full" />
          </div>
        </ItemContent>
        <ItemActions>
          <Skeleton className="size-7 rounded-md" />
        </ItemActions>
      </Item>
    </div>
  )
}

export function SetupSkeleton() {
  return (
    <div role="status" aria-label="Loading setup" className="flex flex-col gap-6">
      <AuthHeadingSkeleton />
      <div className="flex flex-col gap-3">
        <Item variant="outline" className="flex-nowrap">
          <ItemMedia>
            <Skeleton className="size-4 rounded-full" />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-28" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-full" />
            </div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          </ItemContent>
          <ItemActions>
            <Skeleton className="h-7 w-16 rounded-md" />
          </ItemActions>
        </Item>
        <CopyRowSkeleton />
        <CopyRowSkeleton />
      </div>
      <AuthButtonSkeleton />
    </div>
  )
}

export function DeviceConfirmSkeleton() {
  return (
    <div role="status" aria-label="Checking the device code" className="flex flex-col gap-6">
      <AuthHeadingSkeleton descriptionLines={2} />
      <Item variant="outline">
        <ItemContent className="items-center">
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex h-10 items-center">
            <Skeleton className="h-8 w-56" />
          </div>
        </ItemContent>
      </Item>
      <AuthTextLineSkeleton width="w-64" />
      <div className="flex flex-col gap-2">
        <AuthButtonSkeleton />
        <AuthButtonSkeleton />
      </div>
      <div className="flex h-9.75 flex-col justify-between">
        <Skeleton className="mx-auto h-3 w-full" />
        <Skeleton className="mx-auto h-3 w-2/3" />
      </div>
    </div>
  )
}
