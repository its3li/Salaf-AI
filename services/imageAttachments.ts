import type { Attachment } from '../types';
export { IMAGE_CREDITS, MAX_IMAGES_PER_MESSAGE, imageMessageCredits } from '../api/_lib/imagePolicy';
export type AttachedImage = { name: string; mimeType: string; data: string };
export const attachedImages = (attachment?: Attachment): AttachedImage[] => attachment?.images ||
  (attachment?.mimeType.startsWith('image/') && attachment.data ? [{ name: attachment.name, mimeType: attachment.mimeType, data: attachment.data }] : []);
export const bundleImages = (images: AttachedImage[]): Attachment | undefined => images.length ? {
  name: images.length === 1 ? images[0].name : `${images.length} images`, mimeType: 'image/jpeg', data: '', images,
} : undefined;
