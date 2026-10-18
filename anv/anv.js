async function soraFetch(url, options) {
    var opts = options || { headers: {}, method: 'GET', body: null };
    try {
        var res = await fetchv2(url, opts.headers || {}, opts.method || 'GET', opts.body || null);
        return typeof res === 'string' ? res : JSON.stringify(res);
    } catch (e) {
        try {
            var response = await fetch(url, opts);
            if (!response.ok) {
                return null;
            }
            return await response.text();
        } catch (err) {
            return null;
        }
    }
}

async function searchResults(keyword) {
    try {
        if (!keyword) return JSON.stringify([]);
        var encodedKeyword = encodeURIComponent(keyword.trim());
        var responseText = await soraFetch('https://api.anv.to/search?q=' + encodedKeyword + '&language=dub');
        if (!responseText) return JSON.stringify([]);

        var data = JSON.parse(responseText);
        var animes = (data && data.data && data.data.animes) ? data.data.animes : [];

        var results = animes.map(function(anime) {
            return {
                title: anime.name || 'Unknown',
                image: anime.poster || '',
                href: 'https://anv.to/watch/' + anime.id
            };
        });

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractDetails(url) {
    try {
        var match = url.match(/\/watch\/([^?&/]+)/);
        if (!match) return JSON.stringify([]);
        var animeId = match[1];

        var responseText = await soraFetch('https://api.anv.to/anime/' + animeId);
        if (!responseText) return JSON.stringify([]);

        var data = JSON.parse(responseText);
        var animeInfo = (data && data.data && data.data.anime && data.data.anime.info) ? data.data.anime.info : {};
        var moreInfo = (data && data.data && data.data.anime && data.data.anime.moreInfo) ? data.data.anime.moreInfo : {};

        return JSON.stringify([{
            description: animeInfo.description || 'No description available',
            aliases: 'Duration: ' + ((animeInfo.stats && animeInfo.stats.duration) ? animeInfo.stats.duration : 'Unknown'),
            airdate: 'Aired: ' + (moreInfo.aired || 'Unknown')
        }]);
    } catch (error) {
        return JSON.stringify([{
            description: 'Could not load details.',
            aliases: 'Duration: Unknown',
            airdate: 'Aired: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        var match = url.match(/\/watch\/([^?&/]+)/);
        if (!match) return JSON.stringify([]);
        var animeId = match[1];

        var responseText = await soraFetch('https://api.anv.to/anime/' + animeId + '/episodes');
        if (!responseText) return JSON.stringify([]);

        var data = JSON.parse(responseText);
        var episodes = (data && data.data && data.data.episodes) ? data.data.episodes : [];

        var results = episodes.map(function(episode) {
            var rawEpId = String(episode.episodeId || '');
            var epParam = rawEpId.indexOf('?ep=') !== -1 ? rawEpId.split('?ep=')[1] : rawEpId;

            return {
                href: 'https://anv.to/watch/' + animeId + '?ep=' + epParam,
                number: episode.number !== undefined ? episode.number : 1
            };
        });

        return JSON.stringify(results);
    } catch (error) {
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        var epMatch = url.match(/[?&]ep=([^&#]+)/);
        var episodeId = epMatch ? epMatch[1] : null;

        if (!episodeId) return null;

        var responseText = await soraFetch('https://api.anv.to/episode/sources?animeEpisodeId=' + episodeId + '&category=dub');
        if (!responseText) return null;

        var data = JSON.parse(responseText);
        var sources = (data && data.data && data.data.sources) ? data.data.sources : [];
        var hlsSource = null;

        for (var i = 0; i < sources.length; i++) {
            if (sources[i].type === 'hls') {
                hlsSource = sources[i];
                break;
            }
        }

        if (!hlsSource && sources.length > 0) {
            hlsSource = sources[0];
        }

        return hlsSource ? hlsSource.url : null;
    } catch (error) {
        return null;
    }
}
