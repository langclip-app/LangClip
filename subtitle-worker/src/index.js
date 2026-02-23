// YouTube Subtitle Proxy - Cloudflare Worker
// Fetches subtitles from YouTube's innertube API server-side, avoiding CORS issues

const ALLOWED_ORIGINS = [
    'https://langclip-app.github.io',
    'http://localhost',
    'http://127.0.0.1',
];

function corsHeaders(origin) {
    const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o));
    return {
        'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

export default {
    async fetch(request) {
        const origin = request.headers.get('Origin') || '';
        const headers = corsHeaders(origin);

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        const url = new URL(request.url);
        const videoId = url.searchParams.get('v');

        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
                status: 400,
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        try {
            // Step 1: Get caption tracks via innertube API
            const playerBody = JSON.stringify({
                context: {
                    client: {
                        clientName: 'ANDROID',
                        clientVersion: '19.09.37',
                        androidSdkVersion: 30,
                        hl: 'ja',
                        gl: 'JP',
                    },
                },
                videoId,
            });

            const playerResp = await fetch(
                'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w&prettyPrint=false',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: playerBody,
                }
            );

            if (!playerResp.ok) {
                throw new Error(`Innertube API returned ${playerResp.status}`);
            }

            const playerData = await playerResp.json();
            const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

            if (!tracks || tracks.length === 0) {
                return new Response(JSON.stringify({ error: 'No captions available', subtitles: [] }), {
                    status: 200,
                    headers: { ...headers, 'Content-Type': 'application/json' },
                });
            }

            // Pick best track (ja > en > first)
            const track =
                tracks.find(t => t.languageCode === 'ja') ||
                tracks.find(t => t.languageCode === 'en') ||
                tracks[0];

            // Step 2: Fetch the subtitle XML
            const subResp = await fetch(track.baseUrl);
            if (!subResp.ok) {
                throw new Error(`Subtitle XML fetch returned ${subResp.status}`);
            }

            const xml = await subResp.text();

            // Step 3: Parse XML — handle both <text> and <p> formats
            const subtitles = parseSubtitles(xml);

            return new Response(
                JSON.stringify({
                    language: track.languageCode,
                    trackName: track.name?.simpleText || '',
                    count: subtitles.length,
                    subtitles,
                    availableTracks: tracks.map(t => ({
                        languageCode: t.languageCode,
                        name: t.name?.simpleText || '',
                        kind: t.kind || 'manual',
                    })),
                }),
                {
                    status: 200,
                    headers: {
                        ...headers,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600',
                    },
                }
            );
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message, subtitles: [] }), {
                status: 500,
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }
    },
};

function parseSubtitles(xml) {
    const fragments = [];

    // Format 1: <text start="0.0" dur="2.0">content</text>
    const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
        fragments.push({
            start: parseFloat(match[1]),
            duration: parseFloat(match[2] || '2'),
            text: decodeEntities(match[3]).replace(/\n/g, ' ').trim(),
        });
    }

    // Format 2: <p t="10620" d="3000">content</p> (milliseconds)
    if (fragments.length === 0) {
        const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/gi;
        while ((match = pRegex.exec(xml)) !== null) {
            fragments.push({
                start: parseInt(match[1]) / 1000,
                duration: parseInt(match[2]) / 1000,
                text: decodeEntities(match[3]).replace(/\n/g, ' ').trim(),
            });
        }
    }

    if (fragments.length === 0) return [];

    // Group fragments into sentences
    const sentences = [];
    let current = null;

    for (const frag of fragments) {
        if (!current) {
            current = { ...frag };
        } else {
            current.text += ' ' + frag.text;
            current.duration = (frag.start + frag.duration) - current.start;
        }

        // Check if the current text ends a sentence
        // Punctuation: . ! ? 。 ！ ？
        if (/[.!?。！？]$/.test(frag.text.trim())) {
            sentences.push(current);
            current = null;
        }
    }

    // Push the last one if it didn't end with punctuation
    if (current) {
        sentences.push(current);
    }

    return sentences;
}

function decodeEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/<[^>]+>/g, ''); // Strip any remaining HTML tags
}
