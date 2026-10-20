import { Attachment } from '../types';
import { extractPdfText } from './pdfExtraction';

const MB = 1024 * 1024;
export const MAX_IMAGE_FILE_MB = 15;
export const MAX_PDF_FILE_MB = 20;
// Claude downsizes anything larger than ~1568px on the long edge, so sending more only costs bandwidth.
const MAX_IMAGE_DIMENSION = 1568;
const IMAGE_QUALITY = 0.82;

/** A file that can't be attached; the composer words the reason in the interface language. */
export class AttachmentError extends Error {
  constructor(readonly reason: 'pdfTooLarge' | 'imageTooLarge' | 'imageUnreadable' | 'unsupported') {
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
