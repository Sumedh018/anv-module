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
    try {
        if (!keyword || !String(keyword).trim()) {
            return '[]';
        }

        const query = String(keyword)
            .replace(/\bseason\s*\d+\b/gi, '')
            .replace(/\bpart\s*\d+\b/gi, '')
            .replace(/\((?:dub|sub)\)/gi, '')
            .trim() || String(keyword).trim();

        const searchURL =
            'https://anv.to/browse?q=' +
            encodeURIComponent(query);

        const html = await soraFetch(searchURL);

        if (!html) {
            console.log('[ANV] Search: no response');
            return '[]';
        }

        console.log('[ANV] Response length:', html.length);

        const results = [];
        const seen = new Set();

        function addResult(href, title, image) {
            try {
                const fullURL = new URL(href, searchURL);

                if (
                    fullURL.hostname !== 'anv.to' &&
                    !fullURL.hostname.endsWith('.anv.to')
                ) return;

                if (!/^\/(?:anime|watch)\//i.test(fullURL.pathname)) {
                    return;
                }

                title = cleanText(title);
                if (!title || seen.has(fullURL.href)) return;

                seen.add(fullURL.href);

                results.push({
                    title: title,
                    image: absoluteURL(image || '', searchURL),
                    href: fullURL.href
                });
            } catch (_) {}
        }

        // Parse HTML anime cards.
        const linkRegex =
            /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;

        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const attrs = match[1] + ' ' + match[3];
            const href = decodeHTML(match[2]);
            const content = match[4];

            const titleMatch =
                attrs.match(/\btitle=["']([^"']+)["']/i) ||
                content.match(/\btitle=["']([^"']+)["']/i) ||
                content.match(/\balt=["']([^"']+)["']/i);

            const headingMatch = content.match(
                /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i
            );

            const imageMatch = content.match(
                /<img\b[^>]*?\b(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i
            );

            const title = titleMatch
                ? titleMatch[1]
                : headingMatch
                    ? headingMatch[1]
                    : '';

            addResult(
                href,
                title,
                imageMatch ? imageMatch[1] : ''
            );
        }

        // Parse embedded Next.js data.
        const nextMatch = html.match(
            /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
        );

        if (nextMatch) {
            try {
                const data = JSON.parse(nextMatch[1]);

                function walk(value, depth = 0) {
                    if (
                        !value ||
                        typeof value !== 'object' ||
                        depth > 15
                    ) return;

                    if (Array.isArray(value)) {
                        value.forEach(item => walk(item, depth + 1));
                        return;
                    }

                    const href =
                        value.href || value.url ||
                        value.path || value.link;

                    const title =
                        value.title || value.name ||
                        value.englishTitle || value.romaji;

                    const image =
                        value.poster || value.posterUrl ||
                        value.coverImage || value.thumbnail ||
                        (typeof value.image === 'string'
                            ? value.image
                            : '');

                    if (
                        typeof href === 'string' &&
                        typeof title === 'string'
                    ) {
                        addResult(href, title, image);
                    }

                    Object.values(value).forEach(
                        item => walk(item, depth + 1)
                    );
                }

                walk(data);
            } catch (error) {
                console.log('[ANV] Next.js data parsing failed');
            }
        }

        console.log('[ANV] Results found:', results.length);

        return JSON.stringify(results);
    } catch (error) {
        console.log(
            '[ANV] Search error:',
            error.message || error
        );
        return '[]';
    }
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
