export default {
	async fetch(request, env, ctx) {
		switch (request.method) {
			case 'GET':
				return new Response('Hello World!', {
					headers: { 'Content-Type': 'text/plain' }
				});

			default:
				return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
					status: 405,
					headers: { 'Content-Type': 'application/json' }
				});
		}
	},
};
