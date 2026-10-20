import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_FIELD_LENGTH = 12000;
const DISCORD_FIELD_LIMIT = 1024;
const DISCORD_WEBHOOK_TIMEOUT_MS = 5000;
const FEEDBACK_LIMIT_PER_WINDOW = 5;
const FEEDBACK_WINDOW_MS = 10 * 60 * 1000;

// Best-effort per-instance limiter so a script cannot flood the Discord channel.
const feedbackCounters = new Map<string, { count: number; resetAt: number }>();

const isFeedbackRateLimited = (req: VercelRequest) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  for (const [key, value] of feedbackCounters) {
    if (value.resetAt <= now) feedbackCounters.delete(key);
  }
  const entry = feedbackCounters.get(ip) ?? { count: 0, resetAt: now + FEEDBACK_WINDOW_MS };
  entry.count += 1;
  feedbackCounters.set(ip, entry);
  return entry.count > FEEDBACK_LIMIT_PER_WINDOW;
};

export const clearFeedbackRateLimitForTests = () => feedbackCounters.clear();

interface FeedbackPayload {
  messageId: string;
  reason: string;
  question: string;
  answer: string;
  chatId?: string;
  createdAt?: number;
}

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordWebhookPayload {
  content: string;
  allowed_mentions: {
    parse: [];
  };
  embeds: [
    {
      title: string;
      color: number;
      fields: DiscordField[];
      timestamp: string;
    },
  ];
}

const isNonEmptyString = (value: unknown, maxLength = MAX_FIELD_LENGTH): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

const isFeedbackPayload = (value: unknown): value is FeedbackPayload => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FeedbackPayload>;

  return (
    isNonEmptyString(candidate.messageId, 200) &&
    isNonEmptyString(candidate.reason, 3000) &&
    isNonEmptyString(candidate.question) &&
    isNonEmptyString(candidate.answer) &&
    (candidate.chatId === undefined || isNonEmptyString(candidate.chatId, 200)) &&
    (candidate.createdAt === undefined ||
      (typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)))
  );
};

const truncateDiscordField = (value: string, limit = DISCORD_FIELD_LIMIT) => {
  const normalized = value.trim() || 'غير متوفر';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
};

const getDiscordWebhookUrl = () => {
  const rawUrl = process.env.FEEDBACK_WEBHOOK_URL;
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isDiscordHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com';
    if (url.protocol !== 'https:' || !isDiscordHost || !url.pathname.startsWith('/api/webhooks/')) {
      console.warn('[api/feedback] invalid feedback webhook URL configuration');
      return null;
    }

    return url.toString();
  } catch {
    console.warn('[api/feedback] invalid feedback webhook URL configuration');
    return null;
  }
};

export const createDiscordFeedbackPayload = (
  feedback: FeedbackPayload
): DiscordWebhookPayload => {
  const createdAt = feedback.createdAt ? new Date(feedback.createdAt) : new Date();
  const timestamp = Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString();

  return {
    content: 'ملاحظة جديدة على إجابة Salaf AI',
    allowed_mentions: {
      parse: [],
    },
    embeds: [
      {
        title: 'تم الإبلاغ عن إجابة غير دقيقة',
        color: 13938487,
        fields: [
          {
            name: 'سبب الملاحظة',
            value: truncateDiscordField(feedback.reason),
          },
          {
            name: 'سؤال المستخدم',
            value: truncateDiscordField(feedback.question),
          },
          {
            name: 'إجابة المساعد',
            value: truncateDiscordField(feedback.answer),
          },
          {
            name: 'المعرّفات',
            value: truncateDiscordField(
              `المحادثة: ${feedback.chatId ?? 'غير متوفر'}\nالرسالة: ${feedback.messageId}`,
              DISCORD_FIELD_LIMIT
            ),
          },
        ],
        timestamp,
      },
    ],
  };
};

const sendFeedbackToDiscord = async (feedback: FeedbackPayload) => {
  const webhookUrl = getDiscordWebhookUrl();
  if (!webhookUrl) {
    console.warn('[api/feedback] feedback webhook is not configured');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createDiscordFeedbackPayload(feedback)),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn('[api/feedback] Discord webhook rejected feedback', {
        status: response.status,
        messageId: feedback.messageId,
        chatId: feedback.chatId,
      });
    }
  } catch (error) {
    console.warn('[api/feedback] Discord webhook delivery failed', {
      messageId: feedback.messageId,
      chatId: feedback.chatId,
      error: error instanceof Error ? error.name : 'UnknownError',
    });
  } finally {
    clearTimeout(timeout);
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
  }

  if (!isFeedbackPayload(req.body)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR' } });
  }

  if (isFeedbackRateLimited(req)) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
  }

  const feedback: FeedbackPayload = {
    messageId: req.body.messageId,
    reason: req.body.reason.trim(),
    question: req.body.question.trim(),
    answer: req.body.answer.trim(),
    chatId: req.body.chatId,
    createdAt: req.body.createdAt,
  };

  console.info('[api/feedback] received answer feedback', {
    messageId: feedback.messageId,
    chatId: feedback.chatId,
    reasonLength: feedback.reason.length,
    questionLength: feedback.question.length,
    answerLength: feedback.answer.length,
    createdAt: feedback.createdAt,
  });

  await sendFeedbackToDiscord(feedback);

  return res.status(202).json({ ok: true });
}
