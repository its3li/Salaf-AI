export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Data URL for images; empty for PDFs (only the extracted text is kept)
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
