import type { Messages } from './ar';

const minuteCount = (count: number, n: string) => (count === 1 ? '1 minute' : `${n} minutes`);

const creditCount = (count: number, n: string) => (count === 1 ? '1 credit' : `${n} credits`);

export const en: Messages = {
  appName: 'Salaf AI',
  /** The browser tab title. */
  meta: {
    title: 'Salaf AI | باحث السلف — Ask, and get the answer with its evidence',
    aboutTitle: 'About Salaf AI | باحث السلف',
  },
  languageMenu: 'Change language',

  header: {
    openMenu: 'Open menu',
    showSidebar: 'Show sidebar',
    newQuestion: 'New question',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
  },

  home: {
    title: 'What would you like to look into today?',
    subtitle:
      'Answers with their evidence from the Quran and authentic Sunnah, as the Salaf understood them. Hadith are checked on Dorar when there is any doubt.',
    suggestions: [
      { topic: 'Aqidah', question: 'What is the difference between Tawhid al-Rububiyyah and Tawhid al-Uluhiyyah?' },
      { topic: 'Fiqh', question: 'What is the ruling on Witr prayer, and when is it prayed?' },
      { topic: 'Hadith', question: 'Is the hadith "Seek knowledge even if you have to go to China" authentic?' },
      { topic: 'Tafsir', question: 'What does Ayat al-Kursi mean, briefly?' },
    ],
    disclaimer:
      'A research assistant, not a mufti. Personal fatwas and new issues go to the scholars. Your chats are saved on your device only.',
  },

  chat: {
    offline: "You're offline. You can still read your saved chats, and you can ask again once you're back online.",
    disclaimer: 'AI can make mistakes. Check the sources, and ask the scholars for personal fatwas.',
  },

  sidebar: {
    hide: 'Hide sidebar',
    close: 'Close menu',
    newChat: 'New chat',
    search: 'Search chats',
    conversations: 'Chats',
    noMatches: 'No chats with that name.',
    empty: 'Your chats will show up here.',
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This week',
    older: 'Older',
    rename: 'Rename chat',
    delete: 'Delete chat',
    questionsToday: "Today's credits",
    remaining: (remaining: string, limit: string) => `${remaining} of ${limit} left`,
    settings: 'Settings',
    language: 'Language',
    about: 'About Salaf AI',
    export: 'Export',
    import: 'Import',
    clearAll: 'Clear all',
    support: 'Support the project',
    install: 'Install the app',
  },

  input: {
    label: 'Type your question',
    placeholder: 'Ask about aqidah, fiqh or hadith…',
    placeholderAttachment: 'Ask about the attachment…',
    placeholderOffline: "You're offline right now…",
    placeholderLimit: (time: string) => `Out of credits for today. They renew at ${time}`,
    attach: 'Attach',
    attachLabel: 'Attach a file',
    attachTitle: 'Attach an image, a PDF, or an audio or video file',
    stop: 'Stop',
    stopLabel: 'Stop the answer',
    send: 'Send',
    removeAttachment: 'Remove attachment',
    attachmentPreview: 'Attachment preview',
    pages: (n: string) => (n === '1' ? '1 page' : `${n} pages`),
    pdf: 'PDF file',
    image: 'Image',
    truncated: 'The file is long, so only the first part of its text will be sent.',
    readFailed: "Couldn't read the file. Please try again.",
    limitReached: (time: string) => `You've used today's credits. They renew at ${time}.`,
    remaining: (count: number, n: string) => `${creditCount(count, n)} left today.`,
  },

  attachments: {
    pdfTooLarge: (mb: string) => `The PDF must be ${mb} MB or smaller.`,
    imageTooLarge: (mb: string) => `The image must be ${mb} MB or smaller.`,
    imageUnreadable: "Couldn't read the image. Try a JPG or PNG.",
    unsupported: 'You can attach an image, a PDF, or an audio or video file.',
    pdfNoText: 'No readable text was found in this file. It may be scanned images.',
    pdfExtractFailed: "Couldn't get the text out of the PDF.",
    /** Sent to the assistant when a file arrives without a question. */
    defaultPrompt: 'Go through this file and bring out what is useful in it.',
  },

  media: {
    warning: "The AI only reads what was said. It doesn't see the picture or hear the sound.",
    titleYoutube: 'Add a YouTube video',
    titleFile: 'Add an audio or video file',
    creditsMeter: 'From your credits',
    minutesMeter: "From today's hour of clips",
    /** What this clip uses, shown big in each meter. */
    usesCredits: (count: number, n: string) => creditCount(count, n),
    usesMinutes: (count: number, n: string) => minuteCount(count, n),
    unknown: 'Unknown',
    creditsLeft: (left: string, total: string) => `${left} of ${total} left`,
    minutesLeft: (left: string, total: string) => `${left} of ${total} minutes left`,
    rule: '1 credit for every 6 minutes of a clip, and up to 1 hour of clips a day.',
    unknownLength: "The clip's length isn't known yet, so it's counted after it's processed.",
    overAllowance: "This clip is longer than what you have left today. It will be processed in full, and that's it for clips today.",
    continue: 'Continue',
    checking: 'Checking the link…',
    uploading: (percent: string) => `Uploading the file… ${percent}%`,
    preparing: 'Getting the audio ready…',
    transcribing: 'Turning the speech into text…',
    ready: 'Text ready',
    queued: 'Your message will send by itself once the text is ready.',
    remove: 'Remove clip',
    kinds: { youtube: 'YouTube', audio: 'Audio', video: 'Video' },
    showTranscript: 'Show what was said',
    hideTranscript: 'Hide the text',
    approximateTimes: 'Times are approximate',
    /** Sent to the assistant when a clip arrives without a question. */
    defaultPrompt: 'Summarize this clip and point out its main benefits.',
    openAt: (time: string) => `Open the clip at ${time}`,
    errors: {
      dailyLimit: (time: string) => `You've used today's hour of audio and video. It renews at ${time}.`,
      credits: (time: string) => `You don't have enough credits today for this clip and a question about it. They renew at ${time}.`,
      siteLimit: 'The site has reached its daily limit for clips. Please try again tomorrow, in sha Allah.',
      tooLong: 'This clip is longer than 3 hours, which is the most it can take.',
      youtube: "This video can't be used. It may be private, deleted or a live stream.",
      failed: "Couldn't turn the clip's speech into text, and none of your credits were used. Please try again.",
      unavailable: 'Adding audio and video is not available right now.',
      upload: "Couldn't upload the file. Check your connection and try again.",
      fileTooLarge: (mb: string) => `The clip must be ${mb} MB or smaller.`,
    },
  },

  message: {
    attachedImage: 'Attached image',
    hadith: 'Hadith',
    sources: 'Sources',
    retry: 'Try again',
    copy: 'Copy the answer',
    copied: 'Copied',
    feedback: 'Something wrong in this answer?',
    feedbackAgain: 'Send another note',
  },

  research: {
    preparing: 'Preparing the answer',
    defaultStep: 'Reading your question and preparing the answer',
  },

  errors: {
    trace: (id: string) => `Reference: ${id}`,
    dailyLimit: (time: string | null) =>
      `You've used today's credits. They renew${time ? ` at ${time}` : ' tomorrow'}, your device's time.\n\nEach question costs 1 credit. The limit is there so the service stays free and available to everyone.`,
    burst: "You've sent several questions in a short time. Wait a minute, then try again.",
    invalid: "The message couldn't be sent because its format is wrong. Refresh the page and try again.",
    unavailable: 'The service is unavailable for now. Please try again later.',
    overloaded: 'The service is very busy right now. Please try again in a little while.',
    timeout: 'The service took longer than usual to respond. Please try again in a little while.',
    upstream: "The service didn't respond properly. Please try again in a little while.",
    refused: "This question couldn't be answered. Try wording it differently.",
    empty: 'The service sent back an empty reply. Try again, or word the question differently.',
    offline: "It looks like you're not connected to the internet. Check your network and try again.",
    unknown: 'Sorry, something unexpected went wrong while reaching the service. Please try again.',
  },

  /** Appended as a quote under an answer that did not finish. */
  notes: {
    maxTokens: 'The answer stopped because it reached the maximum length. Type "continue" to get the rest.',
    stopped: 'The answer was stopped before it finished.',
    interrupted: 'The answer was cut off before it finished. Type "continue" to get the rest.',
  },

  chats: {
    newChat: 'New chat',
    imported: 'Imported chat',
    fileTitle: (name: string) => `File: ${name}`,
  },

  dialogs: {
    ok: 'OK',
    cancel: 'Cancel',
    confirm: 'Confirm',
    error: 'Error',
    notice: 'Note',
    feedbackTitle: "What's wrong with the answer?",
    feedbackMessage:
      'Briefly say what was inaccurate or missing. Your note is sent along with the question and the answer, so they can be improved.',
    feedbackPlaceholder: "Write what's wrong or what needs correcting…",
    feedbackSend: 'Send note',
    feedbackFailed: "Couldn't send your note right now. Please try again in a little while.",
    feedbackThanksTitle: 'Note received',
    feedbackThanks: 'JazakAllahu khayran. Your note was sent and will be used to improve the answers.',
    deleteTitle: 'Delete chat',
    deleteMessage: 'Are you sure you want to delete this chat?',
    delete: 'Delete',
    renameTitle: 'Rename',
    chatNamePlaceholder: 'Chat name…',
    save: 'Save',
    emptyName: "The chat name can't be empty.",
    clearTitle: 'Clear all chats',
    clearMessage: "Are you sure you want to delete all your chats? This can't be undone.",
    clearConfirm: 'Clear all',
    exportFailed: "Couldn't export the chats.",
    invalidBackup: "The backup file isn't valid, so nothing was imported.",
    alreadyImported: 'All the chats in this file were already imported.',
    importFailed: "Couldn't import the chats. Make sure the file is correct.",
  },

  installGuide: {
    title: 'Install Salaf AI on your device',
    intro: 'It runs as its own app with its own icon, opens faster, and your saved chats stay available offline.',
    installNow: 'Install now',
    close: 'Close',
    installed: 'The app is installed on this device.',
    offlineNote: "The app is free, doesn't need an app store, and updates itself.",
    platforms: {
      ios: {
        name: 'iPhone and iPad',
        steps: [
          'Open the site in Safari.',
          'Tap the Share button (the square with an arrow) at the bottom or top of the screen.',
          'Choose "Add to Home Screen", then "Add".',
        ],
      },
      android: {
        name: 'Android',
        steps: [
          'Open the site in Chrome, Edge or Samsung Internet.',
          'Tap the browser menu (⋮).',
          'Choose "Install app" or "Add to Home screen".',
        ],
      },
      windows: {
        name: 'Windows',
        steps: [
          'Open the site in Edge or Chrome.',
          'Click the install icon in the address bar, or from the menu (⋯) choose "Apps", then "Install this site as an app".',
          'It will show up in the Start menu, and you can pin it to the taskbar.',
        ],
      },
      mac: {
        name: 'macOS',
        steps: [
          'In Safari: from the "File" menu, choose "Add to Dock".',
          'Or in Chrome and Edge: click the install icon in the address bar.',
          'It will show up in the Dock and in your Applications folder.',
        ],
      },
      linux: {
        name: 'Linux',
        steps: [
          'Open the site in Chrome, Chromium or Edge.',
          'Click the install icon in the address bar, or choose "Install Salaf AI" from the menu.',
          'It will show up with your other apps in the system menu.',
        ],
      },
    },
  },

  install: {
    logoAlt: 'Salaf AI logo',
    title: 'The Salaf AI app',
    subtitle: 'Install the app for a faster, smoother experience',
    install: 'Install',
    installLabel: 'Install the app',
    dismiss: 'Close the install prompt',
  },

  errorBoundary: {
    title: 'Sorry, something went wrong',
    message: 'There was a problem loading this page. Please refresh it or try again later.',
    reload: 'Refresh the page',
  },

  hadithChecker: {
    label: 'Part of the hadith text',
    placeholder: 'Type part of the hadith in Arabic',
    searching: 'Searching…',
    check: 'Check',
    unreachable: "Couldn't reach Dorar right now.",
    openOnDorar: 'Open the search on their site',
    empty: 'No results for this text. Try another part of the hadith.',
    muhaddith: 'Muhaddith:',
    allResults: 'All results on Dorar',
    openNarration: 'Open the hadith on Dorar',
  },

  about: {
    start: 'Start a chat',
    titleStart: 'Ask, and get the answer ',
    titleHighlight: 'with its evidence',
    titleEnd: '',
    intro:
      "Salaf AI is an AI research assistant. It answers your Islamic questions from the Quran and the authentic Sunnah as the Salaf understood them, and checks hadith on Dorar (al-Durar al-Saniyyah) whenever it isn't sure of one.",
    install: 'Install the app',
    freeLine: 'Free, no subscriptions · 50 credits every day',
    howTitle: 'How does it work?',
    steps: [
      {
        title: 'Ask',
        text: 'Type your question about aqidah, fiqh, hadith or tafsir. You can also attach an image, a PDF, or an audio or video file, or paste a YouTube link.',
      },
      {
        title: 'It checks',
        text: "If it isn't sure about a hadith, it looks it up on Dorar for the wording, the number and the scholars' grading. If it isn't sure what a scholar said, it reads it on the scholar's site first.",
      },
      {
        title: 'It answers',
        text: 'You get the answer with its evidence from the Quran and authentic Sunnah, with the sources listed underneath so you can check them yourself.',
      },
    ],
    checkTitle: 'Check a hadith yourself',
    checkIntro: "Type part of any hadith in Arabic and see the scholars' gradings of it on Dorar.",
    faqTitle: 'Common questions',
    faq: [
      {
        question: 'Does Salaf AI give fatwas?',
        answer:
          "No. It's a research assistant that shows what the texts and the statements of the scholars say. It doesn't replace asking the scholars about personal fatwas and new issues.",
      },
      {
        question: 'How does it check hadith?',
        answer:
          "Well-known hadith whose wording and source it knows, it quotes directly. When it isn't sure, or you ask whether a hadith is authentic, it searches the hadith encyclopedia on Dorar and gives the wording, the source, the number and the muhaddith's grading. If it finds nothing to support it, it says so.",
      },
      {
        question: 'What methodology does it follow?',
        answer:
          'The Quran and Sunnah as the Salaf understood them, relying on the books of trusted scholars such as al-Bukhari, Muslim, Ibn Kathir, Ibn Taymiyyah, Ibn al-Qayyim, Ibn Baz, Ibn Uthaymeen and al-Albani.',
      },
      {
        question: 'Is it free?',
        answer:
          'Yes, with no subscription and no account. Everyone gets 50 credits a day, each question costs 1, and the balance renews every day so the service stays available to everyone.',
      },
      {
        question: 'Can it understand YouTube videos and audio or video files?',
        answer:
          "Yes. The speech in the clip is turned into text, and it reads that text, so it doesn't see the picture or hear the tone of voice. Everyone gets 1 hour of clips a day, at 1 credit for every 6 minutes. The audio is sent to AssemblyAI to be turned into text, or to Microsoft through Pollinations if that fails, and files you upload are deleted as soon as that's done.",
      },
      {
        question: 'Where are my chats saved?',
        answer: 'Only on your device. You can export them to a file and import them on another device from the sidebar.',
      },
      {
        question: 'What if I find a mistake in an answer?',
        answer: 'Press "Something wrong in this answer?" under the answer and write your note. It goes straight to the people running the project.',
      },
    ],
    supportTitle: 'Help keep this going',
    supportText: 'The project is self-funded. Your support covers the server costs so it can stay free for everyone.',
    support: 'Support the project',
    instagram: 'Instagram',
    facebook: 'Facebook',
  },
};
