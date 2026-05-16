const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const SUBSOURCE_API_KEY = (process.env.SUBSOURCE_API_KEY || 'sk_9e699073e951a92c9bb52abfcbc1b4fefcb14f7bb66bb052040fbc6e2b20834a').trim();
const SUBSOURCE_BASE_URL = 'https://api.subsource.net/api/v1';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.subsource.stremio.addon',
    version: '1.0.3',
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
    const imdbId = idParts[0]; 
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    console.log(`[Stremio] Demande pour ID: ${imdbId} (${type})`);

    const headers = {
        'X-API-Key': SUBSOURCE_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
    };

    try {
        // STRATÉGIE DIRECTE : On demande à SubSource les sous-titres liés à cet ID IMDb
        // On teste le paramètre movie_id puis imdb_id si nécessaire
        let subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
            params: { q: imdbId }, // Recherche brute par ID IMDb
            headers: headers
        });

        // Si la recherche par 'q' ne donne rien, on tente une approche par recherche textuelle automatique
        if (!subsResponse.data || subsResponse.data.length === 0) {
            console.log(`[SubSource] Recherche brute vide pour ${imdbId}. Tentative via le titre...`);
            
            const metaType = type === 'series' ? 'series' : 'movie';
            const meta = await axios.get(`https://v3-cinemeta.stremio.com/meta/${metaType}/${imdbId}.json`);
            const movieTitle = meta.data?.meta?.name;

            if (movieTitle) {
                subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
                    params: { q: movieTitle },
                    headers: headers
                });
            }
        }

        if (!subsResponse.data || !Array.isArray(subsResponse.data)) {
            console.log(`[SubSource] Aucun sous-titre trouvé.`);
            return res.json({ subtitles: [] });
        }

        console.log(`[SubSource] Récupérés : ${subsResponse.data.length} sous-titres bruts.`);

        // Filtrage pour les séries (Saison / Épisode)
        let filteredSubs = subsResponse.data;
        if (type === 'series' && season && episode) {
            filteredSubs = filteredSubs.filter(sub => 
                (sub.season == season && sub.episode == episode) || 
                (sub.release && sub.release.toLowerCase().includes(`s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`))
            );
        }

        // Mapping des résultats pour Stremio
        const stremioSubtitles = filteredSubs.map(sub => {
            const langRaw = (sub.lang || sub.lang_translated || 'en').toLowerCase();
            
            // Code de langue ISO 639-2 requis pour le sélecteur Stremio
            let stremioLang = 'eng';
            if (langRaw.includes('fr') || langRaw.includes('fren')) stremioLang = 'fre';
            if (langRaw.includes('ar') || langRaw.includes('arab')) stremioLang = 'ara';
            if (langRaw.includes('es') || langRaw.includes('span')) stremioLang = 'spa';

            return {
                id: `subsource-${sub.id}`,
                url: `${SUBSOURCE_BASE_URL}/subtitles/${sub.id}/download`, // Le header X-API-Key gérera l'authentification au clic
                lang: stremioLang,
                label: `[SubSource] ${sub.lang_translated || sub.lang || 'Multi'} - ${sub.release || 'Dossier'}`
            };
        });

        console.log(`[Succès] Envoi de ${stremioSubtitles.length} sous-titres à Stremio.`);
        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error(`[Erreur]`, error.message);
        return res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => console.log(`Addon SubSource v1.0.3 prêt.`));
