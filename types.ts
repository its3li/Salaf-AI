export type MediaKind = 'youtube' | 'audio' | 'video';

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
  /** Audio/video: the transcript the assistant reads instead of the file. */
  media?: MediaTranscript;
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
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}
