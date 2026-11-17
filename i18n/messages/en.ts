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
      'A research assistant, not a mufti. Personal fatwas and new issues go to the scholars. Your chats are saved on your device.',
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
    imagesTooLarge: 'The compressed images are too large. Use smaller images.',
    multipleImagesOnly: 'Multiple images can be attached together; PDFs, audio and video are one file per message.',
    imageMessageLimit: 'You can attach up to 3 images per message.',
    imageDailyLimit: 'You have reached the daily limit of 11 images. It resets with your daily balance.',
    imageCreditsInsufficient: 'Not enough credits for the images and message. Remove some images or send text only.',
    providerUnsupported: 'The file could not be read directly and no usable text fallback was available. Attach scanned PDF pages or video screenshots as images. No guessed answer was shown.',
    imagePrice: (images: string, credits: string) => `${images} images × 2 credits + 1 message credit = ${credits} credits`,
  },

  media: {
    youtubeWarning: 'Only YouTube audio is sent directly to Gemini. If audio is rejected, speech-to-text is used as a fallback; no video frames are sent.',
    warning: 'Direct media is tried first. If audio/video is rejected, a speech transcript is used instead, without visuals or tone of voice. Verify quotations.',
    titleYoutube: 'Add a YouTube video',
    titleFile: 'Add an audio or video file',
    creditsMeter: 'From your credits',
    minutesMeter: "From today's audio/video allowance",
    /** What this clip uses, shown big in each meter. */
    usesCredits: (count: number, n: string) => creditCount(count, n),
    usesMinutes: (count: number, n: string) => minuteCount(count, n),
    unknown: 'Unknown',
    creditsLeft: (left: string, total: string) => `${left} of ${total} left`,
    minutesLeft: (left: string, total: string) => `${left} of ${total} minutes left`,
    rule: '1 credit per 6 minutes, with a strict combined 20-minute audio/video limit per day. YouTube is audio-only.',
    unknownLength: 'The actual audio duration is verified before charging. Clips exceeding the remaining time are rejected.',
    overAllowance: 'This clip exceeds your remaining daily time and cannot be sent today.',
    continue: 'Continue',
    checking: 'Checking the link…',
    uploading: (percent: string) => `Uploading the file… ${percent}%`,
    preparing: 'Preparing the clip…',
    transcribing: 'Preparing the clip for direct analysis…',
    ready: 'Clip ready',
    queued: 'Your message will send automatically once the clip is ready.',
    remove: 'Remove clip',
    kinds: { youtube: 'YouTube', audio: 'Audio', video: 'Video' },
    showTranscript: 'Show what was said',
    hideTranscript: 'Hide the text',
    approximateTimes: 'Times are approximate',
    /** Sent to the assistant when a clip arrives without a question. */
    defaultPrompt: 'Summarize this clip and point out its main benefits.',
    openAt: (time: string) => `Open the clip at ${time}`,
    errors: {
      dailyLimit: (time: string) => `This clip exceeds the remaining time in your daily 20-minute audio/video allowance. It renews at ${time}.`,
      credits: (time: string) => `You don't have enough credits today for this clip and a question about it. They renew at ${time}.`,
      siteLimit: 'The site has reached its daily limit for clips. Please try again tomorrow, in sha Allah.',
      tooLong: 'The clip exceeds the allowed duration (20 minutes per day).',
      durationUnknown: 'Could not verify the duration. Use a standard MP3, WAV or MP4 file.',
      youtube: "This video can't be used. It may be private, deleted or a live stream.",
      failed: "Couldn't prepare the clip for analysis. Check the file and try again.",
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

  share: {
    button: 'Share this conversation',
    title: 'Share this conversation',
    creating: 'Creating the link…',
    explain: "Anyone with the link can read this conversation up to this answer. It's saved exactly as Salaf AI answered and can't be edited. Attached files themselves aren't shared.",
    copy: 'Copy link',
    copied: 'Link copied',
    shareVia: 'Share…',
    stop: 'Stop sharing',
    stopped: 'Sharing stopped. The link no longer works.',
    close: 'Close',
    errorExpired: 'This answer can no longer be shared. Answers can be shared for 180 days.',
    errorGeneric: "The link couldn't be created. Try again shortly.",
    pageLabel: 'Shared conversation',
    verified: "Saved exactly as Salaf AI answered; it can't be edited.",
    partial: 'This conversation had earlier messages that are not shown here.',
    sharedOn: (date: string) => `Shared ${date}`,
    continue: 'Continue this conversation',
    askOwn: 'Ask your own question',
    notFound: "This link doesn't exist or is no longer shared.",
    loading: 'Loading the conversation…',
    attachedImages: (count: number) => (count === 1 ? 'An image was attached (not shown)' : `${count} images were attached (not shown)`),
    attachedFile: (title: string) => `File attached: ${title} (not shown)`,
  },

  blog: {
    nav: 'Blog',
    title: 'Blog',
    subtitle: 'A question every day, answered with evidence from the Quran and authentic Sunnah as the Salaf understood them, with hadith checked.',
    readMore: 'Read the answer',
    loadMore: 'More',
    empty: 'No posts yet. The first question will be published soon, in sha Allah.',
    notFound: "This post doesn't exist.",
    loading: 'Loading…',
    back: 'All questions',
    askMore: 'Ask more about this',
    askOwn: 'Ask your own question',
    autoNote: 'Answered by Salaf AI and checked automatically for its hadith and evidence before publishing.',
    edited: 'This answer was reviewed and corrected by the editor.',
    reviewed: 'Answered by Salaf AI, then reviewed and approved by an editor.',
    published: (date: string) => `Published ${date}`,
    otherLanguages: 'Other languages',
    categories: { aqidah: 'Aqidah', fiqh: 'Fiqh', hadith: 'Hadith', tafsir: 'Tafsir', adab: 'Manners & adhkar', seerah: 'Seerah' } as Record<string, string>,
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
    overloaded: 'The AI provider could not accept this request. It may be busy or rate-limited; this does not mean many people are using the site. Try again shortly.',
    queued: 'Another request has not finished. Your question was not sent to the provider and its credit was refunded. Try again shortly.',
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
    freeLine: 'Free, no subscriptions · 20 credits every day',
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
        question: 'Is there a Salaf AI app?',
        answer:
          'Yes, and it needs no app store. Open the site in your phone or computer browser and press "Install the app" at the top of this page. It then sits on your home screen like any app and opens without the browser bar. It works on Android, iPhone, Windows and Mac.',
      },
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
          'Yes, with no subscription or account. Each browser gets 20 credits a day. A message costs 1 credit, each image adds 2, and audio/video also uses duration-based credits. Images are limited to 3 per message and 11 per day; the credit balance may run out sooner.',
      },
      {
        question: 'Can it understand YouTube videos and audio or video files?',
        answer:
          'Native Gemini input is tried first. Unsupported audio/video falls back to speech-to-text with AssemblyAI, or Microsoft through Pollinations; that mode reads only speech, not visuals or tone. Unsupported PDFs use text extracted on your device; scanned pages may need to be attached as images. YouTube sends audio only. Audio/video is limited to a combined 20 minutes per day. Files are limited to 12 MB; larger-than-2-MB uploads use temporary Vercel Blob URLs. Attachments expire after 24 hours, and uploads are removed during cleanup. Old chats remain readable.',
      },
      {
        question: 'Where are my chats saved?',
        answer: "On your device. The server also keeps an encrypted copy of each answer for 180 days so you can share it; the key stays on your device, so the server can't read it unless you share that conversation. You can export your chats to a file and import them on another device from the sidebar.",
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
