import { Hono } from 'hono';
import { XMLParser } from 'fast-xml-parser';

import corsHeaders from './corsHeaders.js';
import fetch from './fetch.js'
import responseHelper from './responseHelper.js';

import platform from './data/platform.js';

const app = new Hono();

const cache = caches.default;
const cacheDuration = 60 * 60 * 12;
const cacheControl = {
    'Cache-Control': `public, max-age=${cacheDuration}, stale-while-revalidate=${cacheDuration}`
}
const cacheKey = new Request('https://internal/cache/serverless-research', {
    method: 'GET',
});

app.options('*', (c) => {
    return new Response(null, { headers: corsHeaders });
});

app.get('*', async (c) => {
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
            return responseHelper({
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
                    const cached = await env.KV_CACHE.get(`research:orcid`);
                    if (cached) {
                        Object.assign(result, JSON.parse(cached));
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
                        expirationTtl: cacheDuration,
                    });

                    Object.assign(result, formattedData);
                } catch (e) {
                    console.error(e);
                    return null;
                }
            })(),
            (async () => {
                try {
                    const cached = await env.KV_CACHE.get(`research:medium`);
                    if (cached) return result.medium.posts = JSON.parse(cached);

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
                        expirationTtl: cacheDuration,
                    });

                    result.medium.posts = formattedData;
                } catch (e) {
                    console.error(e);
                    return null;
                }
            })(),
        ]);

        const cachedData = responseHelper({
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
        return responseHelper({
            message: e.message,
        }, 500);
    }
});

app.delete('*', async (c) => {
    await cache.delete(cacheKey);
    return responseHelper(null, 204);
});

app.all('*', () => {
    return responseHelper({
        message: 'Method not allowed!',
    }, 405);
});

export default app;
