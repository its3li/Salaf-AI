const SOURCES_START = '[[SOURCES_START]]';
const SOURCES_END = '[[SOURCES_END]]';

export const parseMessageSources = (text: string) => {
  const startIndex = text.indexOf(SOURCES_START);

  if (startIndex === -1) {
    return { displayContent: text, sourcesList: [] as string[] };
  }

  // While an answer is streaming the closing tag may not have arrived yet; hide the partial block anyway.
  const endIndex = text.indexOf(SOURCES_END, startIndex);
  const sourcesBlock =
    endIndex === -1
      ? text.slice(startIndex + SOURCES_START.length)
      : text.slice(startIndex + SOURCES_START.length, endIndex);
  const textAfterSources = endIndex === -1 ? '' : text.slice(endIndex + SOURCES_END.length);

  const sourcesList = sourcesBlock
    .trim()
    .split('\n')
    .map((source) => source.trim())
    .filter(Boolean);

  return {
    displayContent: `${text.slice(0, startIndex)}${textAfterSources}`.trim(),
    sourcesList,
  };
};
