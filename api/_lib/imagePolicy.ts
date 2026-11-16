// Shared browser/server policy. No credentials or server-only dependencies in this module.
export const IMAGE_CREDITS = 2;
export const MAX_IMAGES_PER_MESSAGE = 3;
export const DAILY_IMAGE_LIMIT = 11;
export const MAX_IMAGE_TOTAL_BYTES = Math.floor(2.5 * 1024 * 1024);
export const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+=*)$/;
export const imageMessageCredits = (count: number) => 1 + IMAGE_CREDITS * count;
export const payloadImages = (message: { image?: string; images?: string[] }) => message.images || (message.image ? [message.image] : []);
