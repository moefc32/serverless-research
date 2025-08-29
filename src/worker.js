import { XMLParser } from 'fast-xml-parser';
import platform from './platform.json' assert { type: 'json' };

const application = 'Mfc API';
const contentTypeJson = {
	'Content-Type': 'application/json',
};

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
			case 'GET':
				try {
					const medium_id = env.CONFIG_MEDIUM_ID;
					const orcid_id = env.CONFIG_ORCID_ID;

					if (!medium_id || !orcid_id) {
						return new Response(JSON.stringify({
							application,
							message: 'Missing environment variable(s)!',
						}), {
							status: 500,
							headers: contentTypeJson,
						});
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

					if (orcidResponse.ok) {
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
						console.error(`ORCID API returned ${behanceResponse.status}: ${text}`);
					}

					if (mediumResponse.ok) {
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
						console.error(`Medium API returned ${mediumResponse.status}: ${text}`);
					}

					return new Response(JSON.stringify({
						application,
						message: 'Fetch data success.',
						data: result,
					}), {
						headers: contentTypeJson,
					});
				} catch (e) {
					return new Response(JSON.stringify({
						application,
						message: e.message,
					}), {
						status: 500,
						headers: contentTypeJson,
					});
				}

			case 'DELETE':
				return new Response(null, { status: 204 });

			default:
				return new Response(JSON.stringify({
					application,
					message: 'Method not allowed!'
				}), {
					status: 405,
					headers: contentTypeJson,
				});
		}
	},
};
