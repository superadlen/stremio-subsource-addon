const express = require('express');
const axios = require('axios');
const AdmZip = require('adm-zip');
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
    version: '1.0.6',
    name: 'DZ-Subtitles',
    description: 'Brings decompressed subtitles from SubSource.net to Stremio',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt']
};

app.get('/', (req, res) => res.json(manifest));
app.get('/manifest.json', (req, res) => res.json(manifest));

// 1. ROUTE PRINCIPALE : Recherche des sous-titres
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    const idParts = id.split(':');
    const imdbId = idParts[0];
    const season = idParts[1] ? parseInt(idParts[1]) : null;
    const episode = idParts[2] ? parseInt(idParts[2]) : null;

    const headers = {
        'X-API-Key': SUBSOURCE_API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Stremio-SubSource-Addon/1.0'
    };

    try {
        const searchResponse = await axios.get(`${SUBSOURCE_BASE_URL}/movies/search`, {
            params: {
                searchType: 'imdb',
                imdb: imdbId,
                type: type === 'series' ? 'series' : 'movie'
            },
            headers: headers
        });

        if (!searchResponse.data || !searchResponse.data.success || !searchResponse.data.data || searchResponse.data.data.length === 0) {
            return res.json({ subtitles: [] });
        }

        const subsourceMovieId = searchResponse.data.data[0].movieId;

        const subsResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles`, {
            params: { movieId: subsourceMovieId },
            headers: headers
        });

        if (!subsResponse.data || !subsResponse.data.success || !subsResponse.data.data || !Array.isArray(subsResponse.data.data)) {
            return res.json({ subtitles: [] });
        }

        let fetchedSubs = subsResponse.data.data;

        if (type === 'series' && season && episode) {
            fetchedSubs = fetchedSubs.filter(sub => {
                const matchRelease = sub.releaseInfo && Array.isArray(sub.releaseInfo) 
                    ? sub.releaseInfo.join(' ').toLowerCase().includes(`s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`)
                    : false;
                return matchRelease || sub.season == season; 
            });
        }

        // On récupère le protocole et l'hôte actuel de notre serveur sur Render pour créer le lien de téléchargement
        const host = req.get('host');
        const protocol = req.protocol;

        const stremioSubtitles = fetchedSubs.map(sub => {
            const langRaw = (sub.language || 'english').toLowerCase();
            
            let stremioLang = 'eng';
            if (langRaw.includes('french') || langRaw.includes('fra')) stremioLang = 'fre';
            if (langRaw.includes('arabic') || langRaw.includes('ara')) stremioLang = 'ara';
            if (langRaw.includes('spanish') || langRaw.includes('spa')) stremioLang = 'spa';

            const releaseLabel = Array.isArray(sub.releaseInfo) ? sub.releaseInfo.join(' ') : 'Release';

            return {
                id: `subsource-${sub.subtitleId}`,
                // ATTENTION : On redirige Stremio vers notre propre serveur pour extraire le ZIP
                url: `${protocol}://${host}/download/${sub.subtitleId}`,
                lang: stremioLang,
                label: `[SubSource] ${sub.language} - ${releaseLabel}`
            };
        });

        return res.json({ subtitles: stremioSubtitles });

    } catch (error) {
        console.error(`[Erreur] :`, error.message);
        return res.json({ subtitles: [] });
    }
});

// 2. NOUVELLE ROUTE : Téléchargement et Décompression automatique du ZIP
app.get('/download/:subtitleId', async (req, res) => {
    const { subtitleId } = req.params;
    console.log(`[Décompression] Traitement du sous-titre ID: ${subtitleId}`);

    try {
        // Téléchargement du fichier ZIP depuis SubSource en format binaire (arraybuffer)
        const zipResponse = await axios.get(`${SUBSOURCE_BASE_URL}/subtitles/${subtitleId}/download`, {
            headers: { 'X-API-Key': SUBSOURCE_API_KEY },
            responseType: 'arraybuffer'
        });

        // Chargement du buffer dans adm-zip
        const zip = new AdmZip(Buffer.from(zipResponse.data));
        const zipEntries = zip.getEntries();

        // Recherche du premier fichier se terminant par .srt ou .vtt dans l'archive
        const subtitleFile = zipEntries.find(entry => 
            entry.entryName.toLowerCase().endsWith('.srt') || 
            entry.entryName.toLowerCase().endsWith('.vtt')
        );

        if (!subtitleFile) {
            console.log(`[Décompression] Aucun fichier .srt trouvé dans le ZIP.`);
            return res.status(404).send('No SRT file found inside the zip archive.');
        }

        // Extraction du texte brut du sous-titre
        const subtitleText = zip.readAsText(subtitleFile);

        // Envoi à Stremio avec les bons en-têtes texte et encodage UTF-8
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${subtitleFile.entryName}"`);
        return res.send(subtitleText);

    } catch (error) {
        console.error(`[Erreur Décompression] :`, error.message);
        return res.status(500).send('Error extracting subtitle.');
    }
});

app.listen(PORT, () => console.log(`Addon SubSource v1.0.6 actif avec extracteur de ZIP.`));
