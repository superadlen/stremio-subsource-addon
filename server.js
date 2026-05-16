const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const SUBSOURCE_API_KEY = "sk_9e699073e951a92c9bb52abfcbc1b4fefcb14f7bb66bb052040fbc6e2b20834a".trim();
const SUBSOURCE_BASE_URL = 'https://api.subsource.net/api/v1';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.subsource.stremio.addon',
    version: '1.0.5',
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
    const imdbId = idParts[0]; // Format ex: tt0816692
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    console.log(`[Stremio] Demande reçue pour ID IMDb : ${imdbId} (${type})`);

    const headers = {
        'X-API-Key': SUBSOURCE_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Stremio-SubSource-Addon/1.0'
    };

    try {
        // ÉTAPE 1 : Recherche du film sur SubSource via l'ID IMDb direct (Spécifié dans leur doc)
        console.log(`[SubSource] Recherche du film par ID IMDb...`);
        const searchResponse = await axios.get(`${SUBSOURCE_BASE_URL}/movies/search`, {
            params: {
                searchType: 'imdb',
                imdb: imdbId,
                type: type === 'series' ? 'series' : 'movie'
            },
            headers: headers
        });

        // Validation de la structure de réponse : { success: true, data: [...] }
        if (!searchResponse.data || !searchResponse.data.success || !searchResponse.data.data || searchResponse.data.data.length === 0) {
            console.log(`[SubSource] Aucun film trouvé pour l'ID IMDb : ${imdbId}`);
            return res.json({ subtitles: [] });
        }

        // Récupération du "movieId" correct depuis le premier résultat
        const subsourceMovieId = searchResponse.data.data[0].movieId;
        console.log(`[SubSource] Match réussi ! ID Interne SubSource (movieId) : ${subsourceMovieId}`);

        // ÉTAPE 2 : Récupération des sous-titres associés à ce movieId
        console.log(`[SubSource] Récupération des sous-titres...`);
        const subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
            params: { 
                movieId: subsourceMovieId
            },
            headers: headers
        });

        if (!subsResponse.data || !subsResponse.data.success || !subsResponse.data.data || !Array.isArray(subsResponse.data.data)) {
            console.log(`[SubSource] Aucun sous-titre trouvé pour le movieId : ${subsourceMovieId}`);
            return res.json({ subtitles: [] });
        }

        let fetchedSubs = subsResponse.data.data;
        console.log(`[SubSource] ${fetchedSubs.length} sous-titres bruts récupérés.`);

        // ÉTAPE 3 : Filtrage des sous-titres (Saison / Épisode pour les séries)
        if (type === 'series' && season && episode) {
            // Note : L'API de recherche d'un film/épisode peut déjà filtrer par saison si spécifié à l'étape 1,
            // mais ce filtre de sécurité local assure la précision pour Stremio.
            fetchedSubs = fetchedSubs.filter(sub => {
                // Si l'objet sous-titre contient directement la saison/épisode (ou via releaseInfo textuel)
                const matchRelease = sub.releaseInfo && Array.isArray(sub.releaseInfo) 
                    ? sub.releaseInfo.join(' ').toLowerCase().includes(`s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`)
                    : false;
                return matchRelease || sub.season == season; 
            });
        }

        // ÉTAPE 4 : Conversion au format requis par Stremio
        const stremioSubtitles = fetchedSubs.map(sub => {
            const langRaw = (sub.language || 'english').toLowerCase();
            
            // Formatage de la langue en ISO 639-2 (3 lettres) pour Stremio
            let stremioLang = 'eng';
            if (langRaw.includes('french') || langRaw.includes('fra')) stremioLang = 'fre';
            if (langRaw.includes('arabic') || langRaw.includes('ara')) stremioLang = 'ara';
            if (langRaw.includes('spanish') || langRaw.includes('spa')) stremioLang = 'spa';

            // Reconstruction de la chaîne d'informations de release (ex: "BluRay 1080p")
            const releaseLabel = Array.isArray(sub.releaseInfo) ? sub.releaseInfo.join(' ') : 'Release';

            return {
                id: `subsource-${sub.subtitleId}`,
                // Route de téléchargement direct spécifiée dans la documentation
                url: `${SUBSOURCE_BASE_URL}/subtitles/${sub.subtitleId}/download`,
                lang: stremioLang,
                label: `[SubSource] ${sub.language} - ${releaseLabel}`
            };
        });

        console.log(`[Addon] Envoi réussi de ${stremioSubtitles.length} sous-titres à Stremio.`);
        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error(`[Erreur Générale] :`);
        if (error.response) {
            console.error(`Status d'erreur de l'API : ${error.response.status}`);
            console.error(`Détails de la réponse :`, JSON.stringify(error.response.data));
        } else {
            console.error(error.message);
        }
        return res.json({ subtitles: [] });
    }
});

app.listen(PORT, () => console.log(`Addon SubSource v1.0.5 prêt et configuré.`));
