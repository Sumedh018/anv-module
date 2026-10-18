/**
 * ANV Provider Engine
 * Handles Next.js hydrated state, fallback DOM parsing, and embed link extraction.
 */
class ANVProvider {
    constructor() {
        this.baseUrl = "https://anv.to";
        this.defaultHeaders = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://anv.to/"
        };
    }

    /**
     * Resolves URLs safely regardless of relative or protocol-relative format
     */
    _normalizeUrl(path) {
        if (!path) return "";
        if (path.startsWith("//")) return "https:" + path;
        if (path.startsWith("http://") || path.startsWith("https://")) return path;
        const cleanBase = this.baseUrl.replace(/\/+$/, "");
        const cleanPath = path.replace(/^\/+/, "");
        return `${cleanBase}/${cleanPath}`;
    }

    /**
     * Attempts extraction from Next.js hydration state (__NEXT_DATA__)
     */
    _extractNextData(html) {
        try {
            const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (!match) return null;
            return JSON.parse(match[1]);
        } catch (e) {
            return null;
        }
    }

    /**
     * Search anime titles with query error recovery
     */
    async search(query) {
        const cleanQuery = query.trim();
        if (!cleanQuery) return [];

        // Common search parameter variations for anime frontends
        const candidateUrls = [
            `${this.baseUrl}/search?keyword=${encodeURIComponent(cleanQuery)}`,
            `${this.baseUrl}/search?query=${encodeURIComponent(cleanQuery)}`,
            `${this.baseUrl}/api/anime/search?q=${encodeURIComponent(cleanQuery)}`
        ];

        let results = [];

        for (const targetUrl of candidateUrls) {
            try {
                const response = await fetch(targetUrl, { headers: this.defaultHeaders });
                if (!response.ok) continue;

                const contentType = response.headers.get("content-type") || "";

                // Case A: JSON API endpoint hit
                if (contentType.includes("application/json")) {
                    const data = await response.json();
                    const list = Array.isArray(data) ? data : (data.results || data.data || data.items || []);
                    if (list.length > 0) {
                        return list.map(item => ({
                            title: item.title || item.name || item.romaji || "Unknown",
                            url: this._normalizeUrl(item.url || item.slug || `/watch/${item.id}`),
                            poster: this._normalizeUrl(item.poster || item.image || item.thumbnail || "")
                        }));
                    }
                }

                // Case B: HTML Response (SSR or Next.js Hydration)
                const html = await response.text();

                // 1. Try Next.js dehydrated state
                const nextData = this._extractNextData(html);
                if (nextData && nextData.props && nextData.props.pageProps) {
                    const pageProps = nextData.props.pageProps;
                    const items = pageProps.animes || pageProps.results || pageProps.data || pageProps.items;
                    if (Array.isArray(items) && items.length > 0) {
                        return items.map(item => ({
                            title: item.title || item.name || "Untitled",
                            url: this._normalizeUrl(item.url || `/watch/${item.slug || item.id}`),
                            poster: this._normalizeUrl(item.image || item.poster || "")
                        }));
                    }
                }

                // 2. Fallback to DOM parsing across common container layouts
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");

                const cardSelectors = [
                    ".anime-card",
                    ".film-item",
                    ".flw-item",
                    "[class*='AnimeCard']",
                    "[class*='item-card']",
                    ".search-result-item",
                    "article"
                ];

                const cards = doc.querySelectorAll(cardSelectors.join(", "));

                cards.forEach(card => {
                    const linkEl = card.querySelector("a[href*='/watch/'], a[href*='/anime/'], a");
                    if (!linkEl) return;

                    const titleEl = card.querySelector("[class*='title'], .film-name, h3, h4") || linkEl;
                    const imgEl = card.querySelector("img");

                    const rawTitle = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
                    const rawHref = linkEl.getAttribute("href") || "";
                    const rawPoster = imgEl ? (imgEl.getAttribute("data-src") || imgEl.getAttribute("src") || "") : "";

                    if (rawTitle && rawHref && !rawHref.startsWith("javascript:")) {
                        results.push({
                            title: rawTitle,
                            url: this._normalizeUrl(rawHref),
                            poster: this._normalizeUrl(rawPoster)
                        });
                    }
                });

                // Deduplicate results by URL
                if (results.length > 0) {
                    const seen = new Set();
                    return results.filter(item => {
                        if (seen.has(item.url)) return false;
                        seen.add(item.url);
                        return true;
                    });
                }
            } catch (err) {
                // Continue to next URL candidate if network/parsing fails
                continue;
            }
        }

        return results;
    }

    /**
     * Extract episode listing for a selected anime
     */
    async getEpisodes(animeUrl) {
        const fullUrl = this._normalizeUrl(animeUrl);
        const res = await fetch(fullUrl, { headers: this.defaultHeaders });
        const html = await res.text();

        // 1. Check for Next.js dehydrated episode list
        const nextData = this._extractNextData(html);
        if (nextData && nextData.props && nextData.props.pageProps) {
            const pageProps = nextData.props.pageProps;
            const eps = pageProps.episodes || (pageProps.anime && pageProps.anime.episodes);
            if (Array.isArray(eps) && eps.length > 0) {
                return eps.map((ep, idx) => ({
                    number: ep.number || (idx + 1),
                    title: ep.title || `Episode ${ep.number || (idx + 1)}`,
                    url: this._normalizeUrl(ep.url || `${fullUrl}?ep=${ep.number || ep.id}`)
                }));
            }
        }

        // 2. DOM Parsing for episodes
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const episodes = [];

        const episodeElements = doc.querySelectorAll(
            ".episodes-list a, .episode-item, [class*='episode'] a, a[href*='ep=']"
        );

        episodeElements.forEach((el, index) => {
            const href = el.getAttribute("href");
            if (!href) return;

            const text = el.textContent.trim();
            const title = el.getAttribute("title") || (text ? `Episode ${text}` : `Episode ${index + 1}`);

            episodes.push({
                number: index + 1,
                title: title,
                url: this._normalizeUrl(href)
            });
        });

        return episodes;
    }

    /**
     * Resolves master m3u8 playlist and required streaming headers
     */
    async getStream(episodeUrl) {
        const fullUrl = this._normalizeUrl(episodeUrl);
        const res = await fetch(fullUrl, { headers: this.defaultHeaders });
        const html = await res.text();

        let streamUrl = "";
        let foundReferer = this.baseUrl;

        // 1. Direct m3u8 source match inside script tags or media elements
        const directHlsMatch = html.match(/(?:file|source|src):\s*["']([^"']+\.m3u8[^"']*)["']/i);
        if (directHlsMatch) {
            streamUrl = directHlsMatch[1];
        } else {
            // 2. Embedded video player iframe inspection
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch) {
                const embedUrl = this._normalizeUrl(iframeMatch[1]);
                foundReferer = embedUrl;

                try {
                    const embedRes = await fetch(embedUrl, {
                        headers: {
                            ...this.defaultHeaders,
                            "Referer": fullUrl
                        }
                    });
                    const embedHtml = await embedRes.text();
                    const embedHlsMatch = embedHtml.match(/["']([^"']+\.m3u8[^"']*)["']/i);
                    if (embedHlsMatch) {
                        streamUrl = embedHlsMatch[1];
                    }
                } catch (e) {
                    // Failover handled below
                }
            }
        }

        return {
            streamType: "HLS",
            url: this._normalizeUrl(streamUrl),
            headers: {
                "Referer": foundReferer,
                "Origin": new URL(foundReferer).origin,
                "User-Agent": this.defaultHeaders["User-Agent"]
            }
        };
    }
}
