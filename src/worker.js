import { XMLParser } from 'fast-xml-parser';
import corsHeaders from './corsHeaders.js';
import responseHelper from './responseHelper.js';

import platform from './data/platform.js';

const cache = caches.default;
const cacheDuration = 60 * 60 * 24;
const cacheControl = { 'Cache-Control': `public, max-age=${cacheDuration}` };

async function apiFetch(url, options = {}) {
	const defaultHeaders = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Win11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36',
		'Accept': 'application/json',
	};

	options.headers = { ...defaultHeaders, ...(options.headers || {}) };
	return fetch(url, options);
}

export default {
	async fetch(request, env, ctx) {
		switch (request.method) {
			case 'OPTIONS':
				return new Response(null, { headers: corsHeaders });

			case 'GET':
				try {
					const cachedResponse = await cache.match(request);

					if (cachedResponse) {
						const age = cachedResponse.headers.get('CF-Cache-Age');
						if (age !== null && parseInt(age) < cacheDuration) {
							return cachedResponse;
						}
					}

					const medium_id = env.CONFIG_MEDIUM_ID;
					const orcid_id = env.CONFIG_ORCID_ID;

					if (!medium_id || !orcid_id) {
						return responseHelper({
							message: 'Missing environment variable(s)!',
						}, 500);
					}

					const orcidResponse = await apiFetch(
						`https://pub.orcid.org/v3.0/${orcid_id}/activities`);
					const mediumResponse = await apiFetch(
						`https://medium.com/feed/@${medium_id}`);

					const result = {
						education: [],
						publication: [],
						platform,
						medium: {
							posts: [],
							url: `https://medium.com/${medium_id}`
						},
					};

					if (orcidResponse?.ok) {
						const data = await orcidResponse.json();

						data?.educations['affiliation-group'].flatMap((group) =>
							group.summaries.map(s => {
								const edu = s['education-summary'];

								result.education.push({
									startYear: edu['start-date'].year?.value || '',
									endYear: edu['end-date'].year?.value || '',
									title: edu['role-title'],
									department: edu['department-name'],
									university: edu.organization.name,
								});
							})
						);

						data?.works.group.flatMap((group) =>
							group['work-summary'].map(w => {
								result.publication.push({
									title: w.title.title.value,
									journal: w['journal-title']?.value || null,
									year: w['publication-date'].year?.value || '',
									url: w.url?.value || null,
								});
							})
						);
					} else {
						const text = await orcidResponse.text();
						console.error(`ORCID API failed: ${text}`);
					}

					if (mediumResponse?.ok) {
						const xml = await mediumResponse.text();
						const parser = new XMLParser();
						const data = parser.parse(xml);

						result.medium.posts = (data.rss.channel.item.slice(0, 12) || []).map((post) => {
							const content = post['content:encoded'] || ''
							const match = content.match(/<img[^>]*src="([^"]+)"/)
							const postImage = match ? match[1] : null

							return {
								title: post.title,
								date: post.pubDate,
								url: post.link.split('?')[0],
								image: postImage
							}
						});
					} else {
						const text = await mediumResponse.text();
						console.error(`Medium API failed: ${text}`);
					}

					const cachedData = responseHelper({
						message: 'Fetch data success.',
						data: result,
					}, 200, {
						...cacheControl,
					});

					ctx.waitUntil(cache.put(request, cachedData.clone()));
					return cachedData;
				} catch (e) {
					return responseHelper({
						message: e.message,
					}, 500);
				}

			case 'DELETE':
				await cache.delete(request);
				return responseHelper(null, 204);

			default:
				return responseHelper({
					message: 'Method not allowed!'
				}, 405);
		}
	},
};
