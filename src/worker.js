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
							error: 'Missing environment variable(s)',
						}), {
							status: 500,
							headers: { 'Content-Type': 'application/json' },
						});
					}

					const response = await apiFetch(`https://pub.orcid.org/v3.0/${orcid_id}/activities`);

					if (!response.ok) {
						const text = await response.text();

						return new Response(JSON.stringify({
							error: `ORCID API returned ${response.status}: ${text}`,
						}), {
							status: response.status,
							headers: { 'Content-Type': 'application/json' },
						});
					}

					const data = await response.json();
					const result = {
						education: [],
						publication: [],
					};

					data.educations['affiliation-group'].flatMap((group) =>
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

					data.works.group.flatMap((group) =>
						group['work-summary'].map(w => {
							result.publication.push({
								title: w.title.title.value,
								journal: w['journal-title']?.value || null,
								year: w['publication-date'].year?.value || '',
								url: w.url?.value || null,
							});
						})
					);

					return new Response(JSON.stringify(result), {
						headers: { 'Content-Type': 'application/json' },
					});
				} catch (e) {
					return new Response(JSON.stringify({
						error: e.message,
					}), {
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					});
				}

			case 'DELETE':
				return new Response(null, { status: 204 });

			default:
				return new Response(JSON.stringify({ error: 'Method not allowed' }), {
					status: 405,
					headers: { 'Content-Type': 'application/json' },
				});
		}
	},
};
