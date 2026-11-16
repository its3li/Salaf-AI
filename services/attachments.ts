import { Attachment } from '../types';
import { extractPdfText } from './pdfExtraction';
import { MAX_IMAGE_TOTAL_BYTES } from '../api/_lib/imagePolicy';
import type { AttachedImage } from './imageAttachments';

const MB = 1024 * 1024;
export const MAX_IMAGE_FILE_MB = 15;
export const MAX_PDF_FILE_MB = 12;
// Keep image requests compact while retaining enough detail for scanned book pages.
const MAX_IMAGE_DIMENSION = 1568;
const IMAGE_QUALITY = 0.82;

/** A file that can't be attached; the composer words the reason in the interface language. */
export class AttachmentError extends Error {
  constructor(readonly reason: 'pdfTooLarge' | 'imageTooLarge' | 'imageUnreadable' | 'unsupported' | 'imagesTooLarge') {
    super(reason);
  }
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be decoded'));
    image.src = src;
  });

/** Re-encodes an image as a JPEG no larger than MAX_IMAGE_DIMENSION on its long edge. */
export const compressImageDataUrl = async (dataUrl: string): Promise<string> => {
  const isSmallJpeg = dataUrl.startsWith('data:image/jpeg') && dataUrl.length < 1_500_000;
  if (isSmallJpeg) return dataUrl;

  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available');
  // JPEG has no alpha channel; paint white first so transparent areas don't turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
};

/** Give all images a fair byte budget so the JSON request stays under Vercel's body limit. */
export const compressImageBundle = async (images: AttachedImage[]): Promise<AttachedImage[]> => {
  const bytes = (data: string) => Math.floor((data.slice(data.indexOf(',') + 1).length * 3) / 4);
  if (images.reduce((sum, image) => sum + bytes(image.data), 0) <= MAX_IMAGE_TOTAL_BYTES) return images;
  const budget = Math.floor(MAX_IMAGE_TOTAL_BYTES / images.length);
  return Promise.all(images.map(async (image) => {
    if (bytes(image.data) <= budget) return image;
    const source = await loadImage(image.data);
    let edge = Math.min(MAX_IMAGE_DIMENSION, Math.max(source.naturalWidth, source.naturalHeight));
    for (let attempt = 0; attempt < 10; attempt++) {
      const scale = Math.min(1, edge / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new AttachmentError('imageUnreadable');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', Math.max(.45, .8 - attempt * .04));
      if (bytes(data) <= budget) return { ...image, data, mimeType: 'image/jpeg' };
      edge *= .8;
    }
    throw new AttachmentError('imagesTooLarge');
  }));
};

const isPdf = (file: File) =>
  file.type === 'application/pdf' || (!file.type && file.name.toLowerCase().endsWith('.pdf'));

export const prepareAttachment = async (file: File): Promise<Attachment> => {
  if (isPdf(file)) {
    if (file.size > MAX_PDF_FILE_MB * MB) {
      throw new AttachmentError('pdfTooLarge');
    }

    // Only the extracted text is sent and stored; the PDF itself never leaves the device.
    const attachment: Attachment = { name: file.name, mimeType: 'application/pdf', data: '' };
    try {
      const result = await extractPdfText(file);
      attachment.extractedText = result.text;
      attachment.pageCount = result.pageCount;
      attachment.textTruncated = result.truncated;
      if (!result.text.trim()) {
        attachment.extractionError = 'pdfNoText';
      }
    } catch (error) {
      console.error('Failed to extract PDF text:', error);
      attachment.extractionError = 'pdfExtractFailed';
    }
    return attachment;
  }

  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE_FILE_MB * MB) {
      throw new AttachmentError('imageTooLarge');
    }
    try {
      const data = await compressImageDataUrl(await readFileAsDataUrl(file));
      return { name: file.name, mimeType: 'image/jpeg', data };
    } catch (error) {
      console.error('Failed to read image:', error);
      throw new AttachmentError('imageUnreadable');
    }
  }

  throw new AttachmentError('unsupported');
};
