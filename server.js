const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// On nettoie la clé de tout espace invisible
const SUBSOURCE_API_KEY = (process.env.SUBSOURCE_API_KEY || 'sk_9e699073e951a92c9bb52abfcbc1b4fefcb14f7bb66bb052040fbc6e2b20834a').trim();
const SUBSOURCE_BASE_URL = 'https://api.subsource.net/api/v1';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.subsource.stremio.addon',
    version: '1.0.2',
    name: 'SubSource Subtitles',
    description: 'Brings subtitles from SubSource.net to Stremio',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt']
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    const idParts = id.split(':');
    const imdbId = idParts[0]; // tt0816692
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    console.log(`\n--- [NOUVELLE TENTATIVE] ID: ${imdbId} ---`);

    // Configuration stricte des Headers requis par SubSource
    const headers = {
        'X-API-Key': SUBSOURCE_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };

    let searchResponse = null;

    // --- STRATÉGIE 1 : Recherche directe par ID IMDb ---
    try {
        console.log(`[Tentative 1] Recherche via paramètre 'q' avec l'ID IMDb: ${imdbId}`);
        searchResponse = await axios.get(`${SUBSOURCE_BASE_URL}/movies/search`, {
            params: { q: imdbId },
            headers: headers
        });
    } catch (e1) {
        console.log(`[Tentative 1] Échouée (Status ${e1.response ? e1.response.status : 'No Response'})`);
        
        // --- STRATÉGIE 2 : Si la 1 fait un 400, on essaye avec le nom réel du film via Cinemeta ---
        try {
            console.log(`[Tentative 2] Récupération du nom du film sur Cinemeta...`);
            const metaType = type === 'series' ? 'series' : 'movie';
            const meta = await axios.get(`https://v3-cinemeta.stremio.com/meta/${metaType}/${imdbId}.json`);
            const movieTitle = meta.data?.meta?.name;

            if (movieTitle) {
                console.log(`[Tentative 2] Recherche sur SubSource avec le titre exact: "${movieTitle}"`);
                searchResponse = await axios.get(`${SUBSOURCE_BASE_URL}/movies/search`, {
                    params: { q: movieTitle },
                    headers: headers
                });
            }
        } catch (e2) {
            console.log(`[Tentative 2] Échouée également (Status ${e2.response ? e2.response.status : 'No Response'})`);
        }
    }

    // Si aucune des deux stratégies de recherche n'a fonctionné ou n'a renvoyé de données
    if (!searchResponse || !searchResponse.data || searchResponse.data.length === 0) {
        console.log(`[Échec Global] Impossible de trouver une correspondance de film pour ${imdbId}`);
        return res.json({ subtitles: [] });
    }

    try {
        const subsourceMovie = searchResponse.data[0];
        console.log(`[Match Réussi] Id SubSource trouvé : ${subsourceMovie.id} (${subsourceMovie.title})`);

        // Étape 3 : Récupération des sous-titres
        console.log(`[SubSource] Requête vers /subtitles avec movie_id: ${subsourceMovie.id}`);
        const subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
            params: { movie_id: subsourceMovie.id },
            headers: headers
        });

        if (!subsResponse.data || !Array.isArray(subsResponse.data)) {
            console.log(`[SubSource] Aucun sous-titre disponible.`);
            return res.json({ subtitles: [] });
        }

        let filteredSubs = subsResponse.data;
        if (type === 'series' && season && episode) {
            filteredSubs = filteredSubs.filter(sub => sub.season == season && sub.episode == episode);
        }

        const stremioSubtitles = filteredSubs.map(sub => {
            return {
                id: `subsource-${sub.id}`,
                url: `${SUBSOURCE_BASE_URL}/subtitles/${sub.id}/download?key=${SUBSOURCE_API_KEY}`,
                lang: sub.lang === 'French' || sub.lang_translated === 'French' ? 'fre' : 'eng',
                label: `[SubSource] ${sub.lang_translated || sub.lang || 'EN'} - ${sub.release || 'HD'}`
            };
        });

        console.log(`[Succès] ${stremioSubtitles.length} sous-titres envoyés.`);
        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error(`[Erreur finale]`, error.response ? error.response.data : error.message);
        return res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => console.log(`Addon actif sur le port ${PORT}`));
