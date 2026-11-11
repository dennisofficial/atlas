import { cn } from '@dltech/atlas-ui/lib/utils'

export enum EPreviewMode {
  Thumbnail = 'thumbnail',
  Live = 'live',
}

const THUMBNAIL_CLASS = 'pointer-events-none h-[200%] w-[200%] origin-top-left scale-50'

export function ArtifactPreview({
  url,
  name,
  mode,
  className,
}: {
  url: string
  name: string
  mode: EPreviewMode
  className?: string
}) {
  const live = mode === EPreviewMode.Live
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-xl border border-border bg-card',
        className,
      )}
    >
      <iframe
        src={url}
        title={`${name} preview`}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        tabIndex={live ? 0 : -1}
        aria-hidden={live ? undefined : true}
        className={cn('border-0 bg-white', live ? 'size-full' : THUMBNAIL_CLASS)}
      />
    </div>
  )
}
