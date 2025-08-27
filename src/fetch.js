export default async function (url, options = {}) {
    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Win11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36',
        'Accept': 'application/json',
    }

    options.headers = { ...defaultHeaders, ...(options.headers || {}) }
    return globalThis.fetch(url, options);
}
