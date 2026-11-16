export type MediaKind = 'youtube' | 'audio' | 'video';
export type { NativeFile } from './api/_lib/nativeFiles';

/** A transcript made and signed by /api/media; sent back with the message as it is. */
export interface MediaTranscript {
  kind: MediaKind;
  title: string;
  channel?: string;
  videoId?: string;
  durationSec: number;
  /** Lines like "[12:34] text". */
  transcript: string;
  approximateTimes?: boolean;
  signature: string;
}

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Data URL for images; empty for PDFs and audio/video (only the text is kept)
  /** Multiple images are kept as one attachment; old single-image chats still use data. */
  images?: Array<{ name: string; mimeType: string; data: string }>;
  /** Audio/video: the transcript the assistant reads instead of the file. */
  media?: MediaTranscript;
  /** Signed direct Gemini input; no transcription service is used. */
  native?: import('./api/_lib/nativeFiles').NativeFile;
  /** YouTube: the video's thumbnail. */
  thumbnailUrl?: string;
  extractedText?: string;
  /** Why no text came out of a PDF; the composer explains it in the interface language. */
  extractionError?: 'pdfNoText' | 'pdfExtractFailed';
  pageCount?: number;
  textTruncated?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachment?: Attachment;
  timestamp: Date;
  isError?: boolean;
  errorCode?: string;
  /** The server's saved copy of this answer (see api/_lib/answerRecords); needed to share it. */
  receipt?: AnswerReceipt;
  /** Set once this answer was shared from this browser; the token stops sharing. */
  share?: { id: string; deleteToken: string };
}

export interface AnswerReceipt {
  id: string;
  key: string;
  /** Length of the answer as the server sent it, before any note the app appended. */
  length: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}
