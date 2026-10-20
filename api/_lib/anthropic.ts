/** The SDK appends `/v1/messages` itself, so accept base URLs written with or without the `/v1` suffix. */
export const getBaseUrl = () => {
    const raw = process.env.ANTHROPIC_BASE_URL?.trim();
    if (!raw) return undefined;
    return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
};
