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

// "[12:34]" or "[1:02:15]" not already followed by a link target.
const TIMESTAMP = /\[((?:\d{1,2}:)?\d{1,2}:\d{2})\](?!\()/g;

/** Turns the transcript times an answer cites into markdown links that open the video at that moment. */
export const linkTimestamps = (text: string, videoId: string) =>
  text.replace(TIMESTAMP, (whole, clock: string) => {
    const parts = clock.split(':').map(Number);
    if (parts.slice(1).some((part) => part > 59)) return whole;
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return `[${clock}](https://www.youtube.com/watch?v=${videoId}&t=${seconds}s)`;
  });
