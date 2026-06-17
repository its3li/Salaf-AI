export const parseMessageSources = (text: string) => {
  const sourceRegex = /\[\[SOURCES_START\]\]([\s\S]*?)\[\[SOURCES_END\]\]/;
  const match = text.match(sourceRegex);

  if (!match) {
    return { displayContent: text, sourcesList: [] as string[] };
  }

  const sourcesList = match[1]
    .trim()
    .split('\n')
    .map((source) => source.trim())
    .filter(Boolean);

  return {
    displayContent: text.replace(sourceRegex, '').trim(),
    sourcesList,
  };
};
