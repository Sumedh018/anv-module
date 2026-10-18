/**
 * Global ANV.to Module Engine
 */
const BASE_URL = "https://anv.to";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://anv.to/"
};

function formatUrl(path) {
    if (!path) return "";
    if (path.startsWith("//")) return "https:" + path;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Required Hook: searchResults
 * Executed by the app when querying anime
 */
async function searchResults(keyword) {
    try {
        const cleanQuery = encodeURIComponent(keyword.trim());
        const searchUrl = `${BASE_URL}/search?keyword=${cleanQuery}`;
        
        const response = await fetch(searchUrl, { headers: HEADERS });
        if (!response.ok) return JSON.stringify([]);

        const html = await response.text();

        // 1. Next.js SSR State Check (__NEXT_DATA__)
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextDataMatch) {
            try {
                const parsed = JSON.parse(nextDataMatch[1]);
                const pageProps = parsed?.props?.pageProps;
                const items = pageProps?.animes || pageProps?.results || pageProps?.data || pageProps?.items;
                
                if (Array.isArray(items) && items.length > 0) {
                    const parsedResults = items.map(item => ({
                        title: item.title || item.name || "Unknown",
                        url: formatUrl(item.url || `/watch/${item.slug || item.id}`),
                        image: formatUrl(item.image || item.poster || item.thumbnail || "")
                    }));
                    return JSON.stringify(parsedResults);
                }
            } catch (e) {
                // Fallback to DOM parsing
            }
        }

        // 2. DOM Selector Extraction
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const cards = doc.querySelectorAll(".anime-card, .film-item, .flw-item, article, [class*='card']");
        const output = [];

        cards.forEach(card => {
            const link = card.querySelector("a[href*='/watch/'], a[href*='/anime/'], a");
            const titleEl = card.querySelector("[class*='title'], .film-name, h3, h4") || link;
            const imgEl = card.querySelector("img");

            if (link && titleEl) {
                const title = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
                const href = link.getAttribute("href") || "";
                const img = imgEl ? (imgEl.getAttribute("data-src") || imgEl.getAttribute("src") || "") : "";

                if (title && href && !href.startsWith("javascript:")) {
                    output.push({
                        title: title,
                        url: formatUrl(href),
                        image: formatUrl(img)
                    });
                }
            }
        });

        // Deduplicate
        const unique = [];
        const seen = new Set();
        for (const item of output) {
            if (!seen.has(item.url)) {
                seen.add(item.url);
                unique.push(item);
            }
        }

        return JSON.stringify(unique);
    } catch (err) {
        return JSON.stringify([]);
    }
}

/**
 * Required Hook: extractDetails / getEpisodes
 * Fetches episode lists
 */
async function extractDetails(url) {
    try {
        const fullUrl = formatUrl(url);
        const res = await fetch(fullUrl, { headers: HEADERS });
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const episodes = [];
        const epNodes = doc.querySelectorAll(".episodes-list a, .episode-item, [class*='episode'] a, a[href*='ep=']");

        epNodes.forEach((node, idx) => {
            const href = node.getAttribute("href");
            if (href) {
                episodes.push({
                    number: idx + 1,
                    title: node.getAttribute("title") || node.textContent.trim() || `Episode ${idx + 1}`,
                    url: formatUrl(href)
                });
            }
        });

        return JSON.stringify(episodes);
    } catch (err) {
        return JSON.stringify([]);
    }
}

/**
 * Required Hook: extractStreamUrl
 * Resolves HLS source
 */
async function extractStreamUrl(url) {
    try {
        const fullUrl = formatUrl(url);
        const res = await fetch(fullUrl, { headers: HEADERS });
        const html = await res.text();

        let streamUrl = "";
        let referer = BASE_URL;

        const m3u8Match = html.match(/(?:file|src):\s*["']([^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match) {
            streamUrl = m3u8Match[1];
        } else {
            const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframe) {
                const embedUrl = formatUrl(iframe[1]);
                referer = embedUrl;
                const embedRes = await fetch(embedUrl, { headers: { ...HEADERS, "Referer": fullUrl } });
                const embedHtml = await embedRes.text();
                const embedM3u8 = embedHtml.match(/["']([^"']+\.m3u8[^"']*)["']/i);
                if (embedM3u8) streamUrl = embedM3u8[1];
            }
        }

        return JSON.stringify({
            streamType: "HLS",
            url: formatUrl(streamUrl),
            headers: {
                "Referer": referer,
                "User-Agent": HEADERS["User-Agent"]
            }
        });
    } catch (err) {
        return JSON.stringify({ streamType: "HLS", url: "", headers: {} });
    }
}
