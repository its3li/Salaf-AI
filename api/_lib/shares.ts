import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from './limits.js';
import { isReceipt, readAnswerRecord, type RecordAttachment, type Receipt } from './answerRecords.js';

/*
 * A shared conversation is a copy of the server's own answer records, followed back from the
 * answer being shared through the answers before it. Only what the server saved is published, so
 * the page can't show anything Salaf AI didn't say.
 */

const SHARE_PREFIX = 'salaf:share:';
const SHARE_TTL_SECONDS = 10 * 365 * 24 * 3600;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const MAX_SHARED_TURNS = 25;

export interface SharedTurn {
    q: string;
    a: string;
    at: number;
    att?: RecordAttachment;
    /** Lets someone continue the conversation and share their continuation in turn. */
    receipt: Receipt;
}

export interface SharedConversation {
    v: 1;
    id: string;
    turns: SharedTurn[];
    /** The first shown answer followed earlier messages that could not be verified, so they're left out. */
    partial: boolean;
    lang: string;
    createdAt: number;
}

interface StoredShare extends SharedConversation {
    /** SHA-256 of the token that can stop sharing; the token itself stays with the person who shared. */
    del: string;
}

export class ShareError extends Error {
    constructor(public status: number, public code: string) {
        super(code);
    }
}

const store = () => getStore({ strict: !!process.env.VERCEL });
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Follows the conversation back from its last receipt, using the keys the browser handed over. */
export const buildConversation = async (receipts: unknown) => {
    if (!Array.isArray(receipts) || receipts.length === 0 || receipts.length > 100 || !receipts.every(isReceipt)) {
        throw new ShareError(400, 'VALIDATION_ERROR');
    }
    const keys = new Map(receipts.map((receipt) => [receipt.id, receipt.key]));
    const turns: SharedTurn[] = [];
    let current: Receipt | null = receipts[receipts.length - 1];
    let partial = false;
    let lang = 'ar';
    while (current) {
        const record = await readAnswerRecord(current);
        if (!record) {
            // The answer being shared must exist; an older link in the chain may have expired.
            if (turns.length === 0) throw new ShareError(404, 'ANSWER_NOT_FOUND');
            partial = true;
            break;
        }
        if (turns.length === 0) lang = record.lang;
        turns.unshift({ q: record.q, a: record.a, at: record.at, ...(record.att ? { att: record.att } : {}), receipt: current });
        if (!record.ok || !record.prev) {
            partial = record.ctx > 0;
            break;
        }
        if (turns.length >= MAX_SHARED_TURNS) {
            partial = true;
            break;
        }
        const key = keys.get(record.prev);
        if (!key) {
            partial = true;
            break;
        }
        current = { id: record.prev, key };
    }
    return { turns, partial, lang };
};

export const createShare = async (receipts: unknown) => {
    const conversation = await buildConversation(receipts);
    const id = randomBytes(9).toString('base64url');
    const deleteToken = randomBytes(24).toString('base64url');
    const share: StoredShare = { v: 1, id, ...conversation, createdAt: Date.now(), del: hashToken(deleteToken) };
    await store().setText(`${SHARE_PREFIX}${id}`, JSON.stringify(share), SHARE_TTL_SECONDS);
    return { id, deleteToken };
};

export const readShare = async (id: string): Promise<SharedConversation | null> => {
    if (!SHARE_ID_PATTERN.test(id)) return null;
    const raw = await store().getText(`${SHARE_PREFIX}${id}`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredShare;
    // The delete hash never leaves the server.
    return { v: stored.v, id: stored.id, turns: stored.turns, partial: stored.partial, lang: stored.lang, createdAt: stored.createdAt };
};

export const deleteShare = async (id: unknown, token: unknown) => {
    if (typeof id !== 'string' || !SHARE_ID_PATTERN.test(id) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        throw new ShareError(400, 'VALIDATION_ERROR');
    }
    const raw = await store().getText(`${SHARE_PREFIX}${id}`);
    if (!raw) return;
    const expected = Buffer.from((JSON.parse(raw) as StoredShare).del, 'hex');
    const given = Buffer.from(hashToken(token), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ShareError(403, 'FORBIDDEN');
    await store().deleteText(`${SHARE_PREFIX}${id}`);
};
