export const baseDuration = 60 * 60 * 24;

export const cacheControl = {
    'Cache-Control': `public, max-age=${baseDuration}, stale-while-revalidate=${baseDuration}`,
}

export function getCacheKey(url) {
    return new Request(url, { method: 'GET' });
}
