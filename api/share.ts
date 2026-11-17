import type { VercelRequest, VercelResponse } from '@vercel/node';
// The .js extension is required: Vercel runs these files as native ES modules without bundling.
import { allowBurst } from './_lib/limits.js';
import { createShare, deleteShare, readShare, ShareError } from './_lib/shares.js';
import { handleShareImage, handleSharePage } from './_lib/sharedPage.js';

// Shared conversations: POST publishes the server's own copy of a conversation, GET reads one for
// the share page, DELETE stops sharing with the token only the person who shared it has.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // /s/<id> pages come here too (vercel.json), so sharing stays one function.
    if (req.query.page === '1') return handleSharePage(req, res);
    if (typeof req.query.og === 'string' && req.method === 'GET') return handleShareImage(req, res);
    try {
        if (req.method === 'GET') {
            const share = await readShare(String(req.query.id ?? ''));
            if (!share) {
                res.setHeader('Cache-Control', 'no-store');
                return res.status(404).json({ error: { code: 'SHARE_NOT_FOUND' } });
            }
            // Short, so stopping a share takes effect within a minute.
            res.setHeader('Cache-Control', 'public, s-maxage=60');
            return res.status(200).json(share);
        }

        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'POST') {
            if (!(await allowBurst(req, 'share', 10))) return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
            const { id, deleteToken } = await createShare(req.body?.receipts);
            return res.status(201).json({ id, deleteToken, path: `/s/${id}` });
        }
        if (req.method === 'DELETE') {
            if (!(await allowBurst(req, 'share-delete', 20))) return res.status(429).json({ error: { code: 'RATE_LIMITED' } });
            await deleteShare(req.body?.id, req.body?.deleteToken);
            return res.status(204).end();
        }
        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } });
    } catch (error) {
        if (error instanceof ShareError) return res.status(error.status).json({ error: { code: error.code } });
        console.warn('[api/share] failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(503).json({ error: { code: 'UNAVAILABLE' } });
    }
}
