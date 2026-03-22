import { Hono } from 'hono';
import { XMLParser } from 'fast-xml-parser';
import corsHeaders from './corsHeaders.js';

import {
    baseDuration,
    cacheControl,
    getCacheKey,
} from '../util/cache.js';
import fetch from '../util/fetch.js'
import sendResponse from '../util/sendResponse.js';

import platform from '../data/platform.js';

const app = new Hono();

const cache = caches.default;
const cacheKey = getCacheKey('https://internal/cache/serverless-research');

app.options('/', (c) => {
    return new Response(null, { headers: corsHeaders });
});

app.get('/', async (c) => {
    const env = c.env;
    const ctx = c.executionCtx;

    try {
        if (c.req.query('refresh') === 'true') {
            await cache.delete(cacheKey);
        } else {
            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) return cachedResponse;
        }

        const medium_id = env.CONFIG_MEDIUM_ID;
        const orcid_id = env.CONFIG_ORCID_ID;

        if (!medium_id || !orcid_id) {
            return sendResponse({
                message: 'Missing environment variable(s)!',
            }, 500);
        }

        const result = {
            education: [],
            publication: [],
            platform,
            medium: {
                posts: [],
                url: `https://medium.com/${medium_id}`
            },
        }

        const response = await Promise.allSettled([
            (async () => {
                try {
                    const cached = await env.KV_CACHE
                        .get(`research:orcid`, { type: 'json' });

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

                    await env.KV_CACHE.put(`research:orcid`,
                        JSON.stringify(formattedData), {
                        expirationTtl: baseDuration * 28,
                    });

                    Object.assign(result, formattedData);
                } catch (e) {
                    console.error(e);
                    return null;
                }
            })(),
            (async () => {
                try {
                    const cached = await env.KV_CACHE
                        .get(`research:medium`, { type: 'json' });

                    if (cached) {
                        result.medium.posts = cached;
                        return;
                    }

                    const mediumResponse = await fetch(
                        `https://medium.com/feed/${medium_id}`);

                    if (!mediumResponse?.ok) {
                        const code = mediumResponse.status;
                        const text = await mediumResponse.text();

                        throw new Error(`Medium API failed (${code}): ${text}`);
                    }

                    const xml = await mediumResponse.text();
                    const parser = new XMLParser();
                    const data = parser.parse(xml);

                    const formattedData = ([].concat(data.rss.channel.item || [])
                        .slice(0, 12) || [])
                        .map((post) => {
                            const content = post['content:encoded'] || '';
                            const match = content.match(/<img[^>]*src="([^"]+)"/);
                            const postImage = match ? match[1] : null;

                            return {
                                title: post.title,
                                date: post.pubDate,
                                url: post.link.split('?')[0],
                                image: postImage,
                            }
                        });

                    await env.KV_CACHE.put(`research:medium`,
                        JSON.stringify(formattedData), {
                        expirationTtl: baseDuration * 14,
                    });

                    result.medium.posts = formattedData;
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
    await cache.delete(cacheKey);
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
        await app.request('/', {}, env);
        console.log('Cron job processed.');
    },
};
