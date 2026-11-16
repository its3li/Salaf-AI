import type { Message } from '../types';
import type { SharedConversation } from '../api/_lib/shares';

export type { SharedConversation };

export class ShareServiceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const sharePath = (id: string) => `/s/${id}`;
export const shareUrl = (id: string) => `${window.location.origin}${sharePath(id)}`;

/** The id in a /s/<id> address, or null on any other page. */
export const shareIdFromPath = (pathname: string) => /^\/s\/([A-Za-z0-9_-]{12})\/?$/.exec(pathname)?.[1] ?? null;

/** Receipts of every answer up to and including this one, oldest first: the server follows them back. */
export const receiptsUpTo = (messages: Message[], messageId: string) => {
  const end = messages.findIndex((message) => message.id === messageId);
  return messages
    .slice(0, end + 1)
    .filter((message) => message.role === 'model' && message.receipt)
    .map((message) => ({ id: message.receipt!.id, key: message.receipt!.key }));
};

const errorCode = async (response: Response) => {
  try {
    return ((await response.json()) as { error?: { code?: string } }).error?.code || `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
};

type CreatedShare = { id: string; deleteToken: string };
// One request per answer even if the dialog mounts twice (React's development double start, a double tap).
const pendingShares = new Map<string, Promise<CreatedShare>>();

export const createShare = (messages: Message[], messageId: string) => {
  const pending = pendingShares.get(messageId);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipts: receiptsUpTo(messages, messageId) }),
    });
    if (!response.ok) throw new ShareServiceError(await errorCode(response));
    return (await response.json()) as CreatedShare;
  })().finally(() => setTimeout(() => pendingShares.delete(messageId), 5000));
  pendingShares.set(messageId, request);
  return request;
};

export const stopSharing = async (id: string, deleteToken: string) => {
  const response = await fetch('/api/share', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, deleteToken }),
  });
  if (!response.ok) throw new ShareServiceError(await errorCode(response));
};

export const fetchShare = async (id: string): Promise<SharedConversation | null> => {
  const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new ShareServiceError(await errorCode(response));
  return (await response.json()) as SharedConversation;
};

/** The shared conversation as the user's own messages, keeping each answer's receipt so it can be shared on. */
export const sharedToMessages = (share: SharedConversation, newId: () => string): Message[] =>
  share.turns.flatMap((turn) => [
    { id: newId(), role: 'user' as const, text: turn.q, timestamp: new Date(turn.at) },
    {
      id: newId(),
      role: 'model' as const,
      text: turn.a,
      timestamp: new Date(turn.at),
      receipt: { id: turn.receipt.id, key: turn.receipt.key, length: turn.a.length },
    },
  ]);
