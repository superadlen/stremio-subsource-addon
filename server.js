const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const SUBSOURCE_API_KEY = process.env.SUBSOURCE_API_KEY || 'sk_9e699073e951a92c9bb52abfcbc1b4fefcb14f7bb66bb052040fbc6e2b20834a';
const SUBSOURCE_BASE_URL = 'https://api.subsource.net/api/v1';

// CORS Headers pour que Stremio puisse interroger l'addon
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Le Manifeste Stremio
const manifest = {
    id: 'org.subsource.stremio.addon',
    version: '1.0.0',
    name: 'SubSource Subtitles',
    description: 'Brings subtitles from SubSource.net to Stremio',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'] // Indique que l'addon traite les IDs IMDb (commençant par tt)
};

app.get('/', (req, res) => {
    return res.json(manifest);
});

app.get('/manifest.json', (req, res) => {
    return res.json(manifest);
});

// 2. Gestion de la requête de sous-titres de Stremio
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    console.log(`Requête reçue pour le type: ${type}, ID: ${id}`);

    // Extraction de l'ID IMDb (ex: tt1234567)
    // Pour les séries, Stremio envoie tt1234567:1:1 (imdbId:saison:episode)
    const idParts = id.split(':');
    const imdbId = idParts[0];
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    try {
        // Étape A: Chercher le film/série sur SubSource via l'ID IMDb
        const searchResponse = await axios.get(`${SUBSOURCE_BASE_URL}/movies/search`, {
            params: { q: imdbId },
            headers: { 'X-API-Key': SUBSOURCE_API_KEY }
        });

        // Si aucun résultat trouvé sur SubSource
        if (!searchResponse.data || searchResponse.data.length === 0) {
            return res.json({ subtitles: [] });
        }

        // Récupérer l'ID SubSource du premier résultat correspondant
        const subsourceMovieId = searchResponse.data[0].id;

        // Étape B: Récupérer la liste des sous-titres disponibles pour cet ID
        const subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
            params: { movie_id: subsourceMovieId },
            headers: { 'X-API-Key': SUBSOURCE_API_KEY }
        });

        if (!subsResponse.data || !Array.isArray(subsResponse.data)) {
            return res.json({ subtitles: [] });
        }

        // Étape C: Filtrer et formater pour Stremio
        let filteredSubs = subsResponse.data;

        // Si c'est une série, on filtre par saison et épisode si l'API SubSource fournit ces infos
        if (type === 'series' && season && episode) {
            filteredSubs = filteredSubs.filter(sub => 
                sub.season == season && sub.episode == episode
            );
        }

        const stremioSubtitles = filteredSubs.map(sub => {
            // L'URL de téléchargement direct requise par Stremio
            const downloadUrl = `${SUBSOURCE_BASE_URL}/subtitles/${sub.id}/download?key=${SUBSOURCE_API_KEY}`;
            
            return {
                id: `subsource-${sub.id}`,
                url: downloadUrl,
                lang: sub.lang || 'fre', // Langue du sous-titre (SubSource utilise généralement des codes à 3 lettres ou le nom complet)
                label: `[SubSource] ${sub.lang_translated || sub.lang || 'Unknown'} - ${sub.release || 'Release'}`
            };
        });

        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error("Erreur lors de la récupération des sous-titres:", error.message);
        return res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon démarré sur le port ${PORT}`);
});
