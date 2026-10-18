/**
 * ShiroX / Sora Scraper - ANV
 */

// Helper to provide headers that bypass standard bot filters
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://anv.to/',
    'Accept': 'application/json, text/plain, */*'
};

async function soraFetch(url, customHeaders = {}) {
    const headers = { ...HEADERS, ...customHeaders };
    try {
        const res = await fetchv2(url, headers, 'GET', null);
        return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (e) {
        try {
            const res = await fetch(url, { method: 'GET', headers: headers });
            if (!res.ok) return null;
            return await res.text();
        } catch (err) {
            console.log('Network error:', err);
            return null;
        }
    }
}

async function searchResults(keyword) {
    try {
        if (!keyword || !keyword.trim()) return JSON.stringify([]);
        const cleanQuery = encodeURIComponent(keyword.trim());

        // Try standard search without strict language filters first to avoid dropping results
        const responseText = await soraFetch(`https://api.anv.to/search?q=${cleanQuery}`);
        if (!responseText) return JSON.stringify([]);

        const data = JSON.parse(responseText);

        // Account for different possible JSON wrapper layouts (data.animes, data.data.animes, or results)
        let list = [];
        if (Array.isArray(data)) {
            list = data;
        } else if (data?.data?.animes && Array.isArray(data.data.animes)) {
            list = data.data.animes;
        } else if (data?.animes && Array.isArray(data.animes)) {
            list = data.animes;
        } else if (data?.results && Array.isArray(data.results)) {
            list = data.results;
        }

        const results = list.map(item => ({
            title: item.name || item.title || item.name_english || 'Unknown',
            image: item.poster || item.image || item.cover || '',
            href: `https://anv.to/watch/${item.id || item._id || item.slug}`
        }));

        return JSON.stringify(results);
    } catch (err) {
        console.log('searchResults error:', err);
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        const match = url.match(/\/watch\/([^?&/]+)/);
        if (!match) return JSON.stringify([]);
        const id = match[1];

        const responseText = await soraFetch(`https://api.anv.to/anime/${id}`);
        if (!responseText) return JSON.stringify([]);

        const data = JSON.parse(responseText);
        const info = data?.data?.anime?.info || data?.data?.info || data?.anime || {};
        const moreInfo = data?.data?.anime?.moreInfo || data?.moreInfo || {};

        return JSON.stringify([{
            description: info.description || info.synopsis || 'No description available.',
            aliases: `Duration: ${info.stats?.duration || info.duration || 'Unknown'}`,
            airdate: `Aired: ${moreInfo.aired || info.aired || 'Unknown'}`
        }]);
    } catch (err) {
        return JSON.stringify([{
            description: 'Could not load details.',
            aliases: 'Duration: Unknown',
            airdate: 'Aired: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const match = url.match(/\/watch\/([^?&/]+)/);
        if (!match) return JSON.stringify([]);
        const id = match[1];

        const responseText = await soraFetch(`https://api.anv.to/anime/${id}/episodes`);
        if (!responseText) return JSON.stringify([]);

        const data = JSON.parse(responseText);
        const epList = data?.data?.episodes || data?.episodes || [];

        const results = epList.map((ep, idx) => {
            const rawId = String(ep.episodeId || ep.id || (idx + 1));
            const cleanId = rawId.includes('?ep=') ? rawId.split('?ep=')[1] : rawId;

            return {
                href: `https://anv.to/watch/${id}?ep=${cleanId}`,
                number: ep.number !== undefined ? ep.number : (idx + 1)
            };
        });

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        const match = url.match(/[?&]ep=([^&#]+)/);
        const episodeId = match ? match[1] : null;
        if (!episodeId) return null;

        const responseText = await soraFetch(`https://api.anv.to/episode/sources?animeEpisodeId=${episodeId}&category=dub`);
        if (!responseText) return null;

        const data = JSON.parse(responseText);
        const sources = data?.data?.sources || data?.sources || [];
        const hls = sources.find(s => s.type === 'hls' || (s.url && s.url.includes('.m3u8'))) || sources[0];

        return hls?.url || null;
    } catch (err) {
        return null;
    }
}
