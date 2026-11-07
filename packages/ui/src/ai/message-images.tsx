'use client'

import { FileTextIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '#components/dialog'

export interface MessageImage {
  id: string
  src: string
  alt: string
}

export interface MessageFile {
  id: string
  name: string
}

export enum EMessageImageSize {
  Thumb = 'thumb',
  Preview = 'preview',
}

const IMAGE_SIZE_CLASS: Record<EMessageImageSize, string> = {
  [EMessageImageSize.Thumb]: 'h-24 w-auto max-w-64 object-cover',
  [EMessageImageSize.Preview]: 'h-auto max-h-80 w-auto max-w-full object-contain',
}

export function MessageImageThumb({
  image,
  size = EMessageImageSize.Thumb,
}: {
  image: MessageImage
  size?: EMessageImageSize
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Open ${image.alt}`}
            className="w-fit overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <img src={image.src} alt={image.alt} className={IMAGE_SIZE_CLASS[size]} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[min(90vw,64rem)]">
        <DialogTitle className="sr-only">{image.alt}</DialogTitle>
        <img
          src={image.src}
          alt={image.alt}
          className="max-h-[80vh] w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  )
}

export function MessageFileCard({ file }: { file: MessageFile }) {
  return (
    <div
      data-slot="message-file"
      title={file.name}
      className="flex h-24 w-28 flex-col overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <FileTextIcon aria-hidden className="size-7" />
      </div>
      <p className="truncate border-t border-foreground/10 px-2 py-1 text-center text-xs text-muted-foreground">
        {file.name}
      </p>
    </div>
  )
}

export function MessageImages({
  images,
  files = [],
}: {
  images: readonly MessageImage[]
  files?: readonly MessageFile[]
}) {
  if (images.length === 0 && files.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image) => (
        <MessageImageThumb key={image.id} image={image} />
      ))}
      {files.map((file) => (
        <MessageFileCard key={file.id} file={file} />
      ))}
    </div>
  )
}
