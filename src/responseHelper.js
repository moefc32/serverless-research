import corsHeaders from './corsHeaders.js';

export default function (payload, status = 200, extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...extraHeaders,
    };

    if (status === 204) {
        return new Response(null, { status, headers });
    }

    return new Response(JSON.stringify({
        application: 'Mfc API',
        ...payload,
    }), { status, headers });
}
