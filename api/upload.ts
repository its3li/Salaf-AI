import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { image, name } = req.body; // Expecting base64 image string

        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        // Validate the image format
        const imagePattern = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
        if (!imagePattern.test(image)) {
            return res.status(400).json({ error: 'Invalid image format' });
        }

        // Return the base64 data URL directly - no external upload needed
        // This works seamlessly with Gemini AI and avoids Discord dependency
        return res.status(200).json({ url: image });

    } catch (error: any) {
        console.error('Upload Error:', error);
        return res.status(500).json({ error: error.message || 'Upload failed' });
    }
}
