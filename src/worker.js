import { Hono } from 'hono';
import { XMLParser } from 'fast-xml-parser';
import corsHeaders from './corsHeaders.js';

import {
    baseDuration,
    cacheControl,
} from '../util/cache.js';
import fetch from '../util/fetch.js';
import sendResponse from '../util/sendResponse.js';

import platform from '../data/platform.js';

const app = new Hono();
const cache = caches.default;

app.options('/', (c) => {
    return new Response(null, { headers: corsHeaders });
});

app.get('/', async (c) => {
    const env = c.env;
    const ctx = c.executionCtx;
    const cacheKey = new Request(c.req.url, {
        method: 'GET',
    });

    try {
        if (c.req.query('refresh') === 'true') {
            await cache.delete(cacheKey);
        } else {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) return cachedResponse;
        }

        const orcid_id = env.CONFIG_ORCID_ID;

        if (!orcid_id) {
            return sendResponse({
                message: 'Missing environment variable(s)!',
            }, 500);
        }

        const result = {
            education: [],
            publication: [],
            platform,
        };

        const response = await Promise.allSettled([
            (async () => {
                try {
                    const cached = await env.KV_CACHE
                        .get('research:orcid', { type: 'json' });

                    if (cached) {
                        Object.assign(result, cached);
                        return;
                    }

                    const orcidResponse = await fetch(
                        `https://pub.orcid.org/v3.0/${orcid_id}/activities`);

                    if (!orcidResponse?.ok) {
                        const code = orcidResponse.status;
                        const text = await orcidResponse.text();

                        throw new Error(`ORCID API failed (${code}): ${text}`);
                    }

                    const data = await orcidResponse.json();

                    const formattedData = {
                        education: [],
                        publication: [],
                    }

                    data?.educations['affiliation-group'].forEach((group) =>
                        group.summaries.map((s) => {
                            const edu = s['education-summary'];

                            formattedData.education.push({
                                startYear: edu['start-date'].year?.value || '',
                                endYear: edu['end-date'].year?.value || '',
                                title: edu['role-title'],
                                department: edu['department-name'],
                                university: edu.organization.name,
                            });
                        })
                    );

                    data?.works.group.forEach((group) =>
                        group['work-summary'].map((w) => {
                            formattedData.publication.push({
                                title: w.title.title.value,
                                journal: w['journal-title']?.value || null,
                                year: w['publication-date'].year?.value || '',
                                url: w.url?.value || null,
                            });
                        })
                    );

                    await env.KV_CACHE.put('research:orcid',
                        JSON.stringify(formattedData), {
                        expirationTtl: baseDuration * 28,
                    });

                    Object.assign(result, formattedData);
                } catch (e) {
                    console.error(e);
                    return null;
                }
            })(),
        ]);

        const cachedData = sendResponse({
            message: 'Fetch data success.',
            data: result,
        }, 200, {
            ...cacheControl,
        });

        if (response.every(r => r.status === 'fulfilled')) {
            ctx.waitUntil(cache.put(cacheKey, cachedData.clone()));
        }

        return cachedData;
    } catch (e) {
        return sendResponse({
            message: e.message,
        }, 500);
    }
});

app.delete('/', async (c) => {
    const env = c.env;
    const kvKeys = ['research:orcid'];
    const cacheKey = new Request(c.req.url, {
        method: 'GET',
    });

    await Promise.allSettled([
        cache.delete(cacheKey),
        ...kvKeys.map((item) => env.KV_CACHE.delete(item))
    ]);

    return sendResponse(null, 204);
});

app.all('*', () => {
    return sendResponse({
        message: 'Method not allowed!',
    }, 405);
});

export default {
    fetch: app.fetch,
    async scheduled(evt, env, ctx) {
        try {
            const url = new URL('/', env.BASE_URL);
            const hour = new Date(evt.scheduledTime).getUTCHours();
            if (hour === 4) url.searchParams.set('refresh', 'true');

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Cloudflare-Cron-Job',
                },
            });

            if (response.ok) {
                console.log('[Cron] Edge cache warmed successfully.');
            } else {
                console.error('[Cron] Warming failed:', response.status);
            }
        } catch (e) {
            console.error(`[Cron] Execution error: ${e.message}`);
        }
    },
};
