import type { PhotoUpload } from '../../../shared/api.ts';
import { ApiError, chosenHeaders } from './api.ts';

// Bilder skaleres ned og kodes på telefonen før opplasting: et mobilbilde på 4–8 MB blir
// ca. 300–500 kB WebP. Det gir raskere opplasting på 4G og raske visninger senere.

const MAX_SIDE = 2048;
const THUMB_SIDE = 400;

async function encode(source: ImageBitmap, maxSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nettleseren kan ikke behandle bilder.');
  ctx.drawImage(source, 0, 0, width, height);
  const toBlob = (type: string) => new Promise<Blob | null>(res => canvas.toBlob(res, type, quality));
  // WebP der nettleseren kan kode det, ellers JPEG (eldre Safari).
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new Error('Kunne ikke kode bildet.');
  return { blob, width, height };
}

export async function compress(file: File) {
  // imageOrientation: 'from-image' retter opp bilder tatt med telefonen på skrå.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const image = await encode(bitmap, MAX_SIDE, 0.82);
    const thumb = await encode(bitmap, THUMB_SIDE, 0.7);
    return { image, thumb };
  } finally {
    bitmap.close();
  }
}

export async function uploadPhoto(callId: string, file: File): Promise<PhotoUpload> {
  const { image, thumb } = await compress(file);
  const ext = (b: Blob) => (b.type === 'image/webp' ? 'webp' : 'jpg');
  const form = new FormData();
  form.set('image', image.blob, `bilde.${ext(image.blob)}`);
  form.set('thumb', thumb.blob, `miniatyr.${ext(thumb.blob)}`);
  form.set('width', String(image.width));
  form.set('height', String(image.height));
  const res = await fetch(`/api/port-calls/${callId}/photos`, { method: 'POST', body: form, credentials: 'same-origin', headers: chosenHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as PhotoUpload;
}
