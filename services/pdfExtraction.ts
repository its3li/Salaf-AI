import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

const MAX_PDF_TEXT_CHARS = 24000;

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  truncated: boolean;
}

const readTextContentItem = (item: unknown) => {
  if (typeof item !== 'object' || item === null) return '';
  const candidate = item as { str?: unknown };
  return typeof candidate.str === 'string' ? candidate.str : '';
};

export const extractPdfText = async (file: File): Promise<PdfExtractionResult> => {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const data = await file.arrayBuffer();
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  let totalLength = 0;
  let truncated = false;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map(readTextContentItem).filter(Boolean).join(' ').trim();

      if (!pageText) continue;

      const remainingChars = MAX_PDF_TEXT_CHARS - totalLength;
      if (remainingChars <= 0) {
        truncated = true;
        break;
      }

      const nextText = pageText.length > remainingChars ? pageText.slice(0, remainingChars) : pageText;
      pageTexts.push(`[Page ${pageNumber}]\n${nextText}`);
      totalLength += nextText.length;

      if (pageText.length > remainingChars) {
        truncated = true;
        break;
      }
    }

    return {
      text: pageTexts.join('\n\n').trim(),
      pageCount: pdf.numPages,
      truncated,
    };
  } finally {
    // Frees the pdf.js worker and the parsed document; otherwise every attached PDF stays in memory.
    await loadingTask.destroy();
  }
};
