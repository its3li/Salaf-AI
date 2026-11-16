import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getStore } from './limits.js';

/*
 * Every answer is kept on the server exactly as it was given, so a shared answer can't be edited:
 * the share page shows only what the server itself saved. Each record is encrypted with its own
 * key, which goes to the asker's browser and is not kept here, so answers nobody shares stay
 * unreadable on the server. Sharing hands the key back for that one conversation.
 */

const RECORD_PREFIX = 'salaf:answer:';
const RECORD_TTL_SECONDS = 180 * 24 * 3600;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const MAX_RECORD_QUESTION_CHARS = 32000;

/** What a question carried besides its text; shown as a note, never as the file itself. */
export type RecordAttachment =
    | { kind: 'images'; count: number }
    | { kind: 'pdf' | 'audio' | 'video' | 'youtube'; title: string };

export interface AnswerRecord {
    v: 1;
    /** The user's question as the server received it. */
    q: string;
    /** The answer exactly as it was sent. */
    a: string;
    at: number;
    lang: string;
    att?: RecordAttachment;
    /** The previous answer in this conversation, when the browser proved it with its key. */
    prev: string | null;
    /** How many messages came before this question in the request. */
    ctx: number;
    /** Every earlier answer the model saw was verified against its record (see verifyContext). */
    ok: boolean;
}

export interface Receipt {
    id: string;
    key: string;
}

export const isReceipt = (value: unknown): value is Receipt =>
    !!value &&
    typeof value === 'object' &&
    ID_PATTERN.test(String((value as Receipt).id)) &&
    KEY_PATTERN.test(String((value as Receipt).key));

const store = () => getStore({ strict: !!process.env.VERCEL });

export const saveAnswerRecord = async (record: Omit<AnswerRecord, 'v'>): Promise<Receipt> => {
    const id = randomBytes(16).toString('base64url');
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    // The id is bound in as associated data, so one record's ciphertext can't be passed off as another's.
    cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([cipher.update(JSON.stringify({ v: 1, ...record }), 'utf8'), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    await store().setText(`${RECORD_PREFIX}${id}`, sealed, RECORD_TTL_SECONDS);
    return { id, key: key.toString('base64url') };
};

/** The record, or null when it doesn't exist, has expired, or the key is wrong. */
export const readAnswerRecord = async (receipt: Receipt): Promise<AnswerRecord | null> => {
    if (!isReceipt(receipt)) return null;
    const sealed = await store().getText(`${RECORD_PREFIX}${receipt.id}`);
    if (!sealed) return null;
    try {
        const raw = Buffer.from(sealed, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', Buffer.from(receipt.key, 'base64url'), raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(receipt.id));
        decipher.setAuthTag(raw.subarray(12, 28));
        const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
        const record = JSON.parse(text) as AnswerRecord;
        return record.v === 1 ? record : null;
    } catch {
        return null;
    }
};

interface ContextMessage {
    role: 'user' | 'assistant';
    text: string;
    receipt?: unknown;
}

/** The browser may shorten very long history; what it sent must still be the start of the original. */
const sameText = (original: string, sent: string) =>
    original === sent || (sent.length >= 1000 && original.startsWith(sent));

/**
 * Checks the history the browser sent with a question against the saved records. `ok` means every
 * earlier answer in it is one this server gave, unedited, in this order, each after the question
 * it answered, so a shared conversation shows exactly what the model saw. `prev` links the new
 * answer to the last one. Nothing here blocks the question; a failed check only limits sharing.
 */
export const verifyContext = async (context: ContextMessage[]): Promise<{ prev: string | null; ok: boolean }> => {
    if (context.length === 0) return { prev: null, ok: true };
    const answers = context.map((message, index) => ({ message, index })).filter(({ message }) => message.role === 'assistant');
    if (answers.length === 0 || answers.some(({ message }) => !isReceipt(message.receipt))) return { prev: null, ok: false };
    const records = await Promise.all(
        answers.map(({ message }) => readAnswerRecord(message.receipt as Receipt).catch(() => null))
    );
    let ok = true;
    for (let i = 0; i < answers.length; i++) {
        const record = records[i];
        const { message, index } = answers[i];
        if (!record || !sameText(record.a, message.text)) return { prev: null, ok: false };
        const question = context[index - 1];
        // The question before an answer must be the one it answered; the window may start mid-pair.
        if (index > 0 && (question?.role !== 'user' || !question.text.startsWith(record.q))) ok = false;
        if (i > 0 && record.prev !== (answers[i - 1].message.receipt as Receipt).id) ok = false;
        if (i > 0 && index !== answers[i - 1].index + 2) ok = false;
    }
    // A user message after the last answer, other than the question being asked now, was not answered.
    if (answers[answers.length - 1].index !== context.length - 1) ok = false;
    const last = answers[answers.length - 1].message.receipt as Receipt;
    return { prev: last.id, ok };
};
