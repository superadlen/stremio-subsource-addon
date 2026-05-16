const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Utilisation directe de ta clé si la variable d'environnement n'est pas configurée
const SUBSOURCE_API_KEY = process.env.SUBSOURCE_API_KEY || 'sk_9e699073e951a92c9bb52abfcbc1b4fefcb14f7bb66bb052040fbc6e2b20834a';
const SUBSOURCE_BASE_URL = 'https://api.subsource.net/api/v1';

// Configuration globale d'Axios pour inclure TOUJOURS la bonne clé API au bon format
const subsourceApi = axios.create({
    baseURL: SUBSOURCE_BASE_URL,
    headers: {
        'X-API-Key': SUBSOURCE_API_KEY.trim(),
        'Accept': 'application/json',
        'User-Agent': 'Stremio-SubSource-Addon/1.0'
    }
});

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.subsource.stremio.addon',
    version: '1.0.1',
    name: 'SubSource Subtitles',
    description: 'Brings subtitles from SubSource.net to Stremio',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt']
};

app.get('/', (res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    console.log(`[Stremio] Requête reçue -> Type: ${type}, ID: ${id}`);

    const idParts = id.split(':');
    const imdbId = idParts[0];
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    try {
        // Étape 1 : Obtenir le titre du film/série depuis l'ID IMDb en utilisant l'API publique de Stremio (Cinemeta)
        // car SubSource 400 si on cherche directement "ttXXXX" dans leur barre de recherche.
        console.log(`[Cinemeta] Récupération du titre pour l'ID IMDb: ${imdbId}`);
        const metaType = type === 'series' ? 'series' : 'movie';
        const metaResponse = await axios.get(`https://v3-cinemeta.stremio.com/meta/${metaType}/${imdbId}.json`);
        
        let searchTitle = "";
        if (metaResponse.data && metaResponse.data.meta && metaResponse.data.meta.name) {
            searchTitle = metaResponse.data.meta.name;
        } else {
            // Si Cinemeta échoue, on tente une recherche brute avec l'id (dernier recours)
            searchTitle = imdbId;
        }

        console.log(`[SubSource] Recherche du film avec le titre : "${searchTitle}"`);

        // Étape 2 : Lancer la recherche sur SubSource avec le vrai titre du film
        const searchResponse = await subsourceApi.get('/movies/search', {
            params: { q: searchTitle }
        });

        if (!searchResponse.data || searchResponse.data.length === 0) {
            console.log(`[SubSource] Aucun résultat trouvé pour : "${searchTitle}"`);
            return res.json({ subtitles: [] });
        }

        // Trouver la meilleure correspondance dans les résultats de SubSource
        const subsourceMovie = searchResponse.data[0];
        console.log(`[SubSource] Match trouvé : ${subsourceMovie.title} (ID: ${subsourceMovie.id})`);

        // Étape 3 : Récupérer les sous-titres associés à ce film
        console.log(`[SubSource] Récupération des sous-titres pour le movie_id: ${subsourceMovie.id}`);
        const subsResponse = await subsourceApi.get('/subtitles', {
            params: { movie_id: subsourceMovie.id }
        });

        if (!subsResponse.data || !Array.isArray(subsResponse.data)) {
            console.log(`[SubSource] Aucun sous-titre trouvé dans la liste.`);
            return res.json({ subtitles: [] });
        }

        let filteredSubs = subsResponse.data;

        // Filtrage spécifique pour les épisodes de séries
        if (type === 'series' && season && episode) {
            filteredSubs = filteredSubs.filter(sub => 
                sub.season == season && sub.episode == episode
            );
        }

        // Étape 4 : Formatage pour Stremio
        const stremioSubtitles = filteredSubs.map(sub => {
            // URL de téléchargement direct (on passe la clé en query param si l'endpoint de download la demande ainsi)
            const downloadUrl = `${SUBSOURCE_BASE_URL}/subtitles/${sub.id}/download?key=${SUBSOURCE_API_KEY.trim()}`;
            
            // SubSource utilise souvent l'ISO short ou complet (ex: "English", "French" ou codes)
            const langName = sub.lang_translated || sub.lang || 'Unknown';
            
            // Conversion basique pour les codes de langue Stremio (Stremio préfère l'ISO 639-2 à 3 lettres)
            let stremioLang = 'eng'; 
            if (langName.toLowerCase().includes('fren') || langName.toLowerCase().includes('fr')) stremioLang = 'fre';
            if (langName.toLowerCase().includes('arab') || langName.toLowerCase().includes('ar')) stremioLang = 'ara';
            if (langName.toLowerCase().includes('span') || langName.toLowerCase().includes('es')) stremioLang = 'spa';

            return {
                id: `subsource-${sub.id}`,
                url: downloadUrl,
                lang: stremioLang,
                label: `[SubSource] ${langName} - ${sub.release || 'Release'}`
            };
        });

        console.log(`[Addon] Envoi de ${stremioSubtitles.length} sous-titres à Stremio.`);
        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error("[Erreur Addon]");
        if (error.response) {
            console.error(`Status de l'erreur : ${error.response.status}`);
            console.error(`Détails renvoyés par l'API :`, error.response.data);
        } else {
            console.error(error.message);
        }
        return res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Addon SubSource en ligne sur le port ${PORT}`);
});
