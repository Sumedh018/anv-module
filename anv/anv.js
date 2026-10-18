/**
 * ShiroX / Sora - ANV Module
 * Search, details, episodes and stream detection updated*2
 */

const BASE_URL = 'https://anv.to/';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

/* -------------------- HTTP -------------------- */

async function soraFetch(url) {
    try {
        let response;

        if (typeof fetchv2 === 'function') {
            response = await fetchv2(url, HEADERS, 'GET', null);
        } else if (typeof fetch === 'function') {
            response = await fetch(url, {
                method: 'GET',
                headers: HEADERS,
                redirect: 'follow'
            });
        } else {
            console.log('[ANV] No fetch implementation available');
            return null;
        }

        if (response == null) return null;

        if (typeof response === 'string') {
            return response;
        }

        if (typeof response.text === 'function') {
            if (response.ok === false) {
                console.log('[ANV] HTTP error:', response.status);
                return null;
            }
            return await response.text();
        }

        const status = response.status ?? response.statusCode;
        if (status != null && Number(status) >= 400) {
            console.log('[ANV] HTTP error:', status);
            return null;
        }

        const body =
            response.body ??
            response.data ??
            response.responseText ??
            response.content;

        if (typeof body === 'string') return body;

        if (body != null && typeof body === 'object') {
            return JSON.stringify(body);
        }

        console.log('[ANV] Unexpected response format');
        return null;
    } catch (error) {
        console.log('[ANV] Fetch error:', error.message || error);
        return null;
    }
}

/* -------------------- HELPERS -------------------- */

function decodeHTML(value = '') {
    return String(value)
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u002F/gi, '/')
        .trim();
}

function cleanText(value = '') {
    return decodeHTML(String(value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')).trim();
}

function absoluteURL(value, base = BASE_URL) {
    if (!value) return '';

    try {
        const url = new URL(decodeHTML(value), base);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return '';
        }
        return url.href;
    } catch (_) {
        return '';
    }
}

function safeJSON(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return '[]';
    }
}

/* -------------------- SEARCH -------------------- */


async function searchResults(keyword) {
    const url =
        'https://anv.to/browse?q=' +
        encodeURIComponent(String(keyword || 'Naruto').trim());

    const response = await soraFetch(url);

    if (!response) {
        console.log('[ANV DEBUG] RESPONSE IS NULL');
        return '[]';
    }

    console.log('[ANV DEBUG] LENGTH:', response.length);
    console.log('[ANV DEBUG] FIRST 500 CHARS:', response.slice(0, 500));

    const matches = response.match(/\/(?:anime|watch)\/[^"' ?]+/gi);

    console.log('[ANV DEBUG] ANIME LINKS:', matches ? matches.length : 0);

    return JSON.stringify([]);
}

/* -------------------- DETAILS -------------------- */

async function extractDetails(url) {
    try {
        const html = await soraFetch(url);

        if (!html) {
            return safeJSON([{
                description: 'No description available.',
                aliases: 'Duration: Unknown',
                airdate: 'Aired: Unknown'
            }]);
        }

        function getMeta(name) {
            const regex = new RegExp(
                '<meta\\b(?=[^>]*(?:property|name)=["\']' +
                name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                '["\'])(?=[^>]*content=["\']([^"\']*)["\'])[^>]*>',
                'i'
            );

            const match = html.match(regex);
            return match ? decodeHTML(match[1]) : '';
        }

        const description =
            getMeta('og:description') ||
            getMeta('description') ||
            'No description available.';

        const duration = html.match(
            /\b\d{1,3}\s*(?:min|minutes)(?:\s*\/\s*ep)?/i
        );

        const aired =
            html.match(/\bAired\s*:\s*([^<\n]+)/i) ||
            html.match(/\bReleased\s*:\s*([^<\n]+)/i);

        return safeJSON([{
            description,
            aliases: 'Duration: ' + (duration ? duration[0] : 'Unknown'),
            airdate: 'Aired: ' +
                (aired ? cleanText(aired[1]) : 'Unknown')
        }]);
    } catch (error) {
        console.log('[ANV] Details error:', error.message || error);

        return safeJSON([{
            description: 'Could not load details.',
            aliases: 'Duration: Unknown',
            airdate: 'Aired: Unknown'
        }]);
    }
}

/* -------------------- EPISODES -------------------- */

async function extractEpisodes(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return '[]';

        const episodes = [];
        const seen = new Set();

        const linkRegex =
            /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const attrs = match[1] + ' ' + match[3];
            const href = absoluteURL(decodeHTML(match[2]), url);
            const text = cleanText(match[4]);

            if (!href || !/^https?:/.test(href)) continue;

            let parsed;
            try {
                parsed = new URL(href);
            } catch (_) {
                continue;
            }

            if (
                parsed.hostname !== 'anv.to' &&
                !parsed.hostname.endsWith('.anv.to')
            ) continue;

            if (!/^\/(?:anime|watch)\//i.test(parsed.pathname)) continue;

            const searchable = href + ' ' + attrs + ' ' + text;

            const patterns = [
                /(?:episode|episodes|ep)[\s/_-]*(\d+(?:\.\d+)?)/i,
                /[?&](?:ep|episode|number)=(\d+(?:\.\d+)?)/i,
                /\/(?:episode|ep)[\s/_-]*(\d+(?:\.\d+)?)(?:\/|$)/i
            ];

            let number = null;

            for (const pattern of patterns) {
                const found = searchable.match(pattern);
                if (found) {
                    number = Number(found[1]);
                    break;
                }
            }

            if (number === null || !Number.isFinite(number)) continue;
            if (seen.has(href)) continue;

            seen.add(href);

            episodes.push({
                href,
                number,
                title: text || 'Episode ' + number
            });
        }

        episodes.sort((a, b) => a.number - b.number);

        console.log('[ANV] Episodes found:', episodes.length);
        return safeJSON(episodes);
    } catch (error) {
        console.log('[ANV] Episode error:', error.message || error);
        return '[]';
    }
}

/* -------------------- STREAM -------------------- */

async function extractStreamUrl(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return null;

        // Direct HLS source.
        const hlsMatch = html.match(
            /["'](https?:\/\/[^"'\s<>\\]+\.m3u8(?:\?[^"'\s<>\\]*)?)["']/i
        );

        if (hlsMatch) {
            return safeJSON({
                type: 'hls',
                url: decodeHTML(hlsMatch[1])
            });
        }

        // Standard video source.
        const videoMatch = html.match(
            /<(?:source|video)\b[^>]*?\bsrc=["']([^"']+)["']/i
        );

        if (videoMatch) {
            const videoURL = absoluteURL(videoMatch[1], url);

            if (videoURL) {
                return safeJSON({
                    type: 'video',
                    url: videoURL
                });
            }
        }

        // Embedded player.
        const iframeMatch = html.match(
            /<iframe\b[^>]*?\bsrc=["']([^"']+)["']/i
        );

        if (iframeMatch) {
            const iframeURL = absoluteURL(iframeMatch[1], url);

            if (iframeURL) {
                return safeJSON({
                    type: 'embed',
                    url: iframeURL
                });
            }
        }

        console.log('[ANV] No playable source found');
        return null;
    } catch (error) {
        console.log('[ANV] Stream error:', error.message || error);
        return null;
    }
}

/* -------------------- EXPORTS -------------------- */

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        searchResults,
        extractDetails,
        extractEpisodes,
        extractStreamUrl
    };
}
