/* ==================================================================
 * anv.to module — search, details, episodes, and stream extraction.
 * ================================================================== */

const ANV_BASE = "https://anv.to";
const MEGAPLAY = "https://megaplay.buzz";
const VIDWISH = "https://vidwish.live";
const VIDTUBE = "https://vidtube.site";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Reusing the same cryptographic and stream builder helpers from above
// (mpDecryptEnc, mpSignUrl, buildStreamResult, etc. remain identical)

class AnvSite {
    static async search(keyword) {
        const url = ANV_BASE + "/filter?keyword=" + encodeURIComponent(keyword);
        console.log("[Anv] Searching: " + url);

        const resp = await soraFetch(url, { headers: { "User-Agent": UA, "Referer": ANV_BASE + "/" } });
        if (!resp || resp.status !== 200) return [];
        const html = await resp.text();

        const gridStart = html.indexOf('id="list-items"');
        if (gridStart === -1) return [];
        const gridEndMarker = html.indexOf("pre-pagination", gridStart);
        const gridHtml = gridEndMarker === -1 ? html.slice(gridStart) : html.slice(gridStart, gridEndMarker);

        const blocks = gridHtml.split('<div class="item ">').slice(1);
        const results = [];
        for (const block of blocks) {
            const slugMatch = block.match(/href="https:\/\/anv\.to\/watch\/([^"\/]+)\/ep-\d+"/);
            const tipMatch = block.match(/data-tip="(\d+)"/);
            const titleMatch = block.match(/<a class="name d-title"[^>]*>([^<]*)<\/a>/);
            const posterMatch = block.match(/<img\s+src="([^"]+)"/);
            if (!slugMatch || !tipMatch) continue;
            results.push({
                slug: slugMatch[1],
                showId: tipMatch[1],
                title: titleMatch ? titleMatch[1].trim() : "Untitled",
                poster: posterMatch ? posterMatch[1] : ""
            });
        }
        return results;
    }

    static async getDetails(slug) {
        const url = ANV_BASE + "/watch/" + slug;
        const resp = await soraFetch(url, { headers: { "User-Agent": UA, "Referer": ANV_BASE + "/" } });
        if (!resp || resp.status !== 200) return null;
        const html = await resp.text();

        const synMatch = html.match(/<div class="synopsis[^"]*">[\s\S]*?<div class="content">([\s\S]*?)<\/div>/);
        const synopsis = synMatch ? synMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trim() : "";

        const getField = (label) => {
            const re = new RegExp(label + ":\\s*<span>\\s*(?:<a[^>]*>)?\\s*([^<]*?)\\s*(?:<\\/a>)?\\s*<\\/span>", "i");
            const m = html.match(re);
            return m ? m[1].trim() : "";
        };

        const genres = [...html.matchAll(/<a href="https:\/\/anv\.to\/genre\/[^"]*">\s*([^<]+?)\s*<\/a>/g)]
            .slice(0, 6).map(m => m[1].trim()).join(", ");

        return { synopsis, aired: getField("Aired"), status: getField("Status"), duration: getField("Duration"), genres };
    }

    static async getEpisodes(showId) {
        const url = ANV_BASE + "/ajax/episode/list/" + showId;
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANV_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return [];
        let json; try { json = await resp.json(); } catch (e) { return []; }
        const html = json?.result || "";

        const episodes = [];
        const re = /<a\s[^>]*data-id="[^"]*"[^>]*>/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const tag = m[0];
            const g = (attr) => tag.match(new RegExp("data-" + attr + '="([^"]*)"'))?.[1] || "";
            const num = g("num"), ids = g("ids");
            if (!num || !ids) continue;
            episodes.push({ num: parseInt(num, 10), hasDub: g("dub") === "1", ids });
        }
        return episodes;
    }

    static async getServerList(idsToken, audio) {
        const url = ANV_BASE + "/ajax/server/list?servers=" + encodeURIComponent(idsToken);
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANV_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return [];
        let json; try { json = await resp.json(); } catch (e) { return []; }
        const html = json?.result || "";

        const items = [];
        const typeRe = /<div class="type" data-type="(sub|dub)">([\s\S]*?)<\/ul>\s*<\/div>/g;
        let typeM;
        while ((typeM = typeRe.exec(html)) !== null) {
            if (typeM[1] !== audio) continue;
            for (const li of typeM[2].matchAll(/<li\s+([^>]*data-link-id[^>]*)>([\s\S]*?)<\/li>/g)) {
                const linkId = li[1].match(/data-link-id="([^"]+)"/)?.[1];
                const name = li[2].replace(/<[^>]+>/g, "").trim();
                if (linkId) items.push({ linkId, name });
            }
        }
        return items;
    }

    static async resolveServer(linkId) {
        const url = ANV_BASE + "/ajax/server?get=" + encodeURIComponent(linkId);
        const resp = await soraFetch(url, {
            headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": ANV_BASE + "/" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return null;
        let json; try { json = await resp.json(); } catch (e) { return null; }
        return json?.result?.url || null;
    }

    static async extractFromEmbed(embedUrl) {
        const host = [MEGAPLAY, VIDWISH, VIDTUBE].find(h => embedUrl.includes(h.replace("https://", "")));
        if (!host) return null;
        const fileId = await extractFileId(embedUrl, host + "/");
        if (!fileId) return null;

        const sParam = (String(embedUrl).match(/[?&]s=([A-Za-z0-9_-]+)/) || [])[1] || "";
        const sSuffix = sParam ? "&s=" + encodeURIComponent(sParam) : "";
        const sourcesUrl = host === VIDTUBE
            ? `${host}/stream/getSourcesNew?id=${fileId}&type=dub` + sSuffix
            : `${host}/stream/getSources?id=${fileId}` + sSuffix;

        const resp = await soraFetch(sourcesUrl, {
            headers: { "Referer": host + "/", "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" }
        });
        if (!resp || resp.status !== 200 || typeof resp.json !== "function") return null;
        let data; try { data = await resp.json(); } catch (e) { return null; }
        if (!data?.sources?.file && !data?.enc) return null;
        return buildStreamResult(data, host + "/");
    }
}

// Module Entry Points for Shirox
async function searchResults(keyword) {
    try {
        const items = await AnvSite.search(keyword);
        return JSON.stringify(items.map(item => ({
            title: item.title,
            image: item.poster,
            href: "anime/" + item.slug + "?showId=" + item.showId
        })));
    } catch (e) {
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const match = url.match(/anime\/([^\/\?]+)/);
        if (!match) throw new Error();
        const details = await AnvSite.getDetails(match[1]);
        return JSON.stringify([{
            description: details?.synopsis || "No description available",
            aliases: details?.genres || "",
            airdate: details?.aired ? "Aired: " + details.aired : "Aired: Unknown"
        }]);
    } catch (e) {
        return JSON.stringify([{ description: "Error loading description", aliases: "", airdate: "Aired: Unknown" }]);
    }
}

async function extractEpisodes(url) {
    try {
        const match = url.match(/anime\/([^\/\?]+)\?showId=(\d+)/);
        if (!match) throw new Error();
        const episodesData = await AnvSite.getEpisodes(match[2]);
        return JSON.stringify(episodesData.filter(ep => ep.hasDub).sort((a, b) => a.num - b.num).map(ep => ({
            href: "anime/" + match[1] + "/" + ep.num + "?ids=" + encodeURIComponent(ep.ids),
            number: ep.num,
            title: "Episode " + ep.num
        })));
    } catch (e) {
        return JSON.stringify([]);
    }
}
