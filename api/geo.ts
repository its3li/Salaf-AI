import type { VercelRequest, VercelResponse } from '@vercel/node';

// The visitor's country, which Vercel's edge adds to every request. The app asks once, on a first
// visit, to open in Urdu for Pakistan, Persian for Iran and Afghanistan, and Arabic in the Arab
// countries even when the browser is in English. Nothing is stored.

export default function handler(req: VercelRequest, res: VercelResponse) {
    // Per visitor: a shared cache would hand one country's answer to everyone.
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const header = req.headers['x-vercel-ip-country'];
    const country = String(Array.isArray(header) ? header[0] : (header ?? '')).toUpperCase();
    return res.status(200).json({ country: /^[A-Z]{2}$/.test(country) ? country : null });
}
