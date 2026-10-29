'use client'

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '#components/dialog'

export interface MessageImage {
  id: string
  src: string
  alt: string
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

export function MessageImages({ images }: { images: readonly MessageImage[] }) {
  if (images.length === 0) return null
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image) => (
        <MessageImageThumb key={image.id} image={image} />
      ))}
    </div>
  )
}
