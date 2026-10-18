/**
 * ANV Module Parser
 */
class ANVProvider {
    constructor() {
        this.baseUrl = "https://anv.to";
    }

    /**
     * Search anime titles
     * @param {string} query
     */
    async search(query) {
        const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const html = await res.text();
        
        // Parse search items from DOM (adapt selectors to anv.to's actual card layout)
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const cards = doc.querySelectorAll(".film-item, .anime-card, article");

        const results = [];
        cards.forEach((card) => {
            const titleEl = card.querySelector(".film-name, .title a, h3 a");
            const imgEl = card.querySelector("img");
            const linkEl = card.querySelector("a");

            if (titleEl && linkEl) {
                results.push({
                    title: titleEl.textContent.trim(),
                    url: linkEl.href.startsWith("http") ? linkEl.href : `${this.baseUrl}${linkEl.getAttribute("href")}`,
                    poster: imgEl ? (imgEl.getAttribute("data-src") || imgEl.src) : ""
                });
            }
        });

        return results;
    }

    /**
     * Fetch episode details for an anime entry
     * @param {string} animeUrl
     */
    async getEpisodes(animeUrl) {
        const res = await fetch(animeUrl);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const episodes = [];
        const episodeElements = doc.querySelectorAll(".episodes-list a, .episode-item");

        episodeElements.forEach((el, index) => {
            episodes.push({
                number: index + 1,
                title: el.getAttribute("title") || `Episode ${index + 1}`,
                url: el.href.startsWith("http") ? el.href : `${this.baseUrl}${el.getAttribute("href")}`
            });
        });

        return episodes;
    }

    /**
     * Resolve playable stream URL (HLS / m3u8)
     * @param {string} episodeUrl
     */
    async getStream(episodeUrl) {
        const res = await fetch(episodeUrl);
        const html = await res.text();

        // Check for embedded iframe or source URL
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        let streamUrl = "";

        if (iframeMatch) {
            const embedUrl = iframeMatch[1].startsWith("//") ? `https:${iframeMatch[1]}` : iframeMatch[1];
            const embedRes = await fetch(embedUrl);
            const embedHtml = await embedRes.text();
            
            // Match m3u8 source
            const m3u8Match = embedHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
            if (m3u8Match) {
                streamUrl = m3u8Match[1];
            }
        }

        return {
            streamType: "HLS",
            url: streamUrl,
            headers: {
                "Referer": this.baseUrl,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        };
    }
}
