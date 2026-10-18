/**
 * ShiroX / Sora Module - ANV (Next.js Compatible)
 */

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://anv.to/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function soraFetch(url) {
    try {
        const res = await fetchv2(url, HEADERS, 'GET', null);
        return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (e) {
        try {
            const res = await fetch(url, { method: 'GET', headers: HEADERS });
            if (!res.ok) return null;
            return await res.text();
        } catch (err) {
            console.log('soraFetch error:', err.message);
            return null;
        }
    }
}

/**
 * Searches for anime from the /browse page
 */
async function searchResults(keyword) {
    try {
        if (!keyword || !keyword.trim()) return JSON.stringify([]);

        const cleanQuery = encodeURIComponent(
            keyword
                .replace(/season\s*\d+/gi, '')
                .replace(/part\s*\d+/gi, '')
                .replace(/\(dub\)/gi, '')
                .replace(/\(sub\)/gi, '')
                .trim() || keyword.trim()
        );

        const html = await soraFetch(`https://anv.to/browse?q=${cleanQuery}`);
        if (!html) return JSON.stringify([]);

        const results = [];

        // In Next.js, anime links point to /anime/[slug-id] or /watch/[slug-id]
        const linkRegex = /<a[^>]+href=["'](\/(?:anime|watch)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const rawHref = match[1];
            const content = match[2];

            // Ignore links to static browse/settings pages
            if (rawHref.includes('/browse') || rawHref.includes('/user')) continue;

            // Extract Poster Image
            const imgMatch = content.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
            const image = imgMatch ? imgMatch[1] : '';

            // Extract Title from alt, title attributes, or inner text
            const titleMatch = content.match(/(?:title|alt)=["']([^"']+)["']/i)
                            || content.match(/<(?:h[1-6]|span|p|div)[^>]*>([^<]+)<\/(?:h[1-6]|span|p|div)>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Unknown';

            // Clean href format
            const href = rawHref.startsWith('http') ? rawHref : `https://anv.to${rawHref}`;

            if (!results.some(item => item.href === href)) {
                results.push({
                    title: title,
                    image: image,
                    href: href
                });
            }
        }

        return JSON.stringify(results);
    } catch (err) {
        console.log('searchResults error:', err.message);
        return JSON.stringify([]);
    }
}

/**
 * Extracts anime metadata
 */
async function extractDetails(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return JSON.stringify([]);

        // Extract metadata from OpenGraph tags or page text
        const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
                       || html.match(/<p[^>]*class=["'][^"']*(?:description|synopsis|overview)[^"']*["'][^>]*>([^<]+)<\/p>/i);

        const durationMatch = html.match(/(\d+\s*min(?:\/ep)?)/i);
        const airedMatch = html.match(/Aired:\s*([^<]+)/i) || html.match(/(\d{4})/);

        return JSON.stringify([{
            description: descMatch ? descMatch[1] : 'No description available.',
            aliases: `Duration: ${durationMatch ? durationMatch[1] : 'Unknown'}`,
            airdate: `Aired: ${airedMatch ? airedMatch[1] : 'Unknown'}`
        }]);
    } catch (err) {
        return JSON.stringify([{
            description: 'Could not load details.',
            aliases: 'Duration: Unknown',
            airdate: 'Aired: Unknown'
        }]);
    }
}

/**
 * Extracts episode list from anime page
 */
async function extractEpisodes(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return JSON.stringify([]);

        const episodes = [];

        // Match episode links (e.g. /watch/[slug]/ep-[num] or ?ep=[num])
        const epRegex = /<a[^>]+href=["'](\/(?:watch|anime)\/[^"']+(?:[?&]ep=|\/ep-?|\/episode-?)(\d+)[^"']*)["'][^>]*>/gi;
        let match;

        while ((match = epRegex.exec(html)) !== null) {
            const rawHref = match[1];
            const epNum = parseInt(match[2], 10);
            const fullHref = rawHref.startsWith('http') ? rawHref : `https://anv.to${rawHref}`;

            if (!episodes.some(e => e.href === fullHref)) {
                episodes.push({
                    href: fullHref,
                    number: isNaN(epNum) ? 1 : epNum
                });
            }
        }

        // Sort episodes sequentially
        episodes.sort((a, b) => a.number - b.number);

        return JSON.stringify(episodes);
    } catch (err) {
        return JSON.stringify([]);
    }
}

/**
 * Extracts direct video stream
 */
async function extractStreamUrl(url) {
    try {
        const html = await soraFetch(url);
        if (!html) return null;

        // Check for direct HLS/m3u8 sources embedded in script/video tags
        const m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match) {
            return m3u8Match[1];
        }

        // Check for embedded video player iframes
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
            const embedUrl = iframeMatch[1];
            const embedHtml = await soraFetch(embedUrl.startsWith('//') ? `https:${embedUrl}` : embedUrl);
            if (embedHtml) {
                const streamMatch = embedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                if (streamMatch) return streamMatch[1];
            }
        }

        return null;
    } catch (err) {
        return null;
    }
}
