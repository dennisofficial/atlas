import { describe, expect, test } from 'bun:test'
import type { ImagePickerAsset } from 'expo-image-picker'

import { ATTACH_SOURCES, EAttachSource } from '../attach-sources'
import { pickedDocumentOf, pickedPhotoOf } from '../picked-files'

const cameraShot: ImagePickerAsset = {
  uri: 'file:///tmp/camera.jpg',
  width: 4032,
  height: 3024,
  fileName: null,
  fileSize: 2048,
  mimeType: 'image/jpeg',
}

describe('attach sources', () => {
  test('offers the camera first, then the library, then files', () => {
    expect(ATTACH_SOURCES.map((option) => option.source)).toEqual([
      EAttachSource.Camera,
      EAttachSource.Library,
      EAttachSource.File,
    ])
  })
})

describe('pickedPhotoOf', () => {
  test('names a camera shot that has no file name', () => {
    expect(pickedPhotoOf({ asset: cameraShot, index: 0, at: 1700 })).toEqual({
      name: 'photo-1700-0.jpg',
      size: 2048,
      mediaType: 'image/jpeg',
      uri: 'file:///tmp/camera.jpg',
    })
  })

  test('keeps a library file name and its HEIC extension', () => {
    const picked = pickedPhotoOf({
      asset: { ...cameraShot, fileName: 'IMG_0001.HEIC', mimeType: 'image/heic' },
      index: 2,
      at: 1700,
    })
    expect(picked.name).toBe('IMG_0001.HEIC')
    expect(picked.mediaType).toBe('image/heic')
  })

  test('names a typeless shot as a jpeg', () => {
    const { mimeType: _dropped, ...typeless } = cameraShot
    expect(pickedPhotoOf({ asset: typeless, index: 1, at: 5 }).name).toBe('photo-5-1.jpg')
  })
})

describe('pickedDocumentOf', () => {
  test('falls back to an octet stream when the picker gives no type', () => {
    expect(
      pickedDocumentOf({ uri: 'file:///tmp/notes', name: 'notes', size: 12, lastModified: 0 }),
    ).toEqual({
      name: 'notes',
      size: 12,
      mediaType: 'application/octet-stream',
      uri: 'file:///tmp/notes',
    })
  })
})
