// Box and group photos: shrunk on the device to a thumbnail (longest side 400 px, WebP) before upload, so a modern
// phone photo of several MB becomes ~20-40 KB. Stored in the public "photos" bucket under <user id>/.

import { requireSupabase } from './supabase.ts'

const MAX_SIDE = 400

export async function toThumbnail(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8))
  if (!blob) throw new Error("Couldn't read that image")
  return blob
}

/** Uploads a thumbnail and returns its storage path. */
export async function uploadPhoto(ownerId: string, file: File): Promise<string> {
  const path = `${ownerId}/${crypto.randomUUID()}.webp`
  const { error } = await requireSupabase()
    .storage.from('photos')
    // A photo is never overwritten (a new photo gets a new path), so browsers may keep it for a year.
    .upload(path, await toThumbnail(file), { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  return path
}

export async function deletePhoto(path: string | null | undefined) {
  if (path) await requireSupabase().storage.from('photos').remove([path])
}
