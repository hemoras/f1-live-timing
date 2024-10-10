const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises
const unzipper = require('unzipper');
const checkAndExtractDirectory = require('./utils');

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];
const manche = process.argv[3];

if (!saison || !manche) {
    console.error('Erreur : vous devez fournir la saison et la manche en paramètres.');
    console.error('Usage : node script.js <saison> <manche>');
    process.exit(1);
}

const directoryPath = `./tfeed-data/${saison}-${manche}`;
const pilotes = [3, 5, 6, 7, 8, 9, 11, 12, 14, 19, 20, 21, 22, 26, 27, 30, 33, 44, 55, 77, 88, 94];

// Configuration de la connexion à la base de données
const dbConfig = {
    host: 'localhost',     // Remplacez par votre hôte
    user: 'root', // Remplacez par votre nom d'utilisateur
    password: '', // Remplacez par votre mot de passe
    database: 'f1-history'  // Remplacez par le nom de votre base de données
};

// Fonction pour comparer et insérer dans la base de données
async function compareAndInsert(connection, newData, oldData, initialTiming) {
    for (const newItem of newData.lignes) {
        const numero = newItem.numero;
        const oldItem = oldData.lignes.find(item => item.numero === numero);

        // Comparaison des lignes pilotes
        if (oldItem) {
            // Comparaison des champs
            const differences = {};
            if (newItem.position !== oldItem.position) differences.position = parseInt(newItem.position, 10);
            if (newItem.pneus.type !== oldItem.pneus.type) differences.pneus = newItem.pneus.type;
            if (newItem.pneus.tours !== oldItem.pneus.tours) differences.pneus_tours = newItem.pneus.tours;
            if (newItem.tours !== oldItem.tours) differences.tours = newItem.tours;
            if (newItem.gap !== oldItem.gap) differences.gap = newItem.gap;
            if (newItem.interval !== oldItem.interval) differences.interval = newItem.interval;
            if (newItem.temps_tour !== oldItem.temps_tour) differences.temps_tour = newItem.temps_tour;
            if (newItem.s1 !== oldItem.s1) differences.s1 = newItem.s1;
            if (newItem.s2 !== oldItem.s2) differences.s2 = newItem.s2;
            if (newItem.s3 !== oldItem.s3) differences.s3 = newItem.s3;
            if (newItem.pit !== oldItem.pit) differences.pit = newItem.pit;
            if (newItem.abandon !== oldItem.abandon) differences.abandon = newItem.abandon;

            // Si des différences sont trouvées, insérer dans la base de données
            if (Object.keys(differences).length > 0) {
                // Construction des colonnes et des valeurs pour l'insertion
                const insertColumns = `saison, manche, numero, timing, ${Object.keys(differences).map(col => `\`${col}\``).join(', ')}`;
                const insertValues = `?, ?, ?, ?, ${Object.values(differences).map(() => '?').join(', ')}`;
            
                // Construction de la clause ON DUPLICATE KEY UPDATE
                const updateClause = Object.keys(differences)
                    .map(key => `\`${key}\` = ?`) // "position = ?" pour chaque clé
                    .join(', ');
            
                // Construction de la requête finale
                const insertQuery = `INSERT INTO live_timing_event (${insertColumns}) VALUES (${insertValues}) ON DUPLICATE KEY UPDATE ${updateClause}`;
            
                //console.log([saison, manche, numero, newItem.timing - initialTiming, ...Object.values(differences)]);
            
                await connection.execute(insertQuery, [saison, manche, numero, newItem.timing - initialTiming, ...Object.values(differences), ...Object.values(differences)]);
            }
            
        }
    }
    // Comparaison des infos générales
    const differences = {};
    if (newData.race_status !== oldData.race_status) differences.race_status = parseInt(newData.race_status, 10);
    if (Object.keys(differences).length > 0) {
        // Construction des colonnes et des valeurs pour l'insertion
        const insertColumns = `saison, manche, timing, ${Object.keys(differences).map(col => `\`${col}\``).join(', ')}`;
        const insertValues = `?, ?, ?, ${Object.values(differences).map(() => '?').join(', ')}`;

        // Construction de la clause ON DUPLICATE KEY UPDATE
        const updateClause = Object.keys(differences)
            .map(key => `\`${key}\` = ?`) // "position = ?" pour chaque clé
            .join(', ');

        // Construction de la requête finale
        const insertQuery = `INSERT INTO live_timing_event (${insertColumns}) VALUES (${insertValues}) ON DUPLICATE KEY UPDATE ${updateClause}`;

        console.log([saison, manche, newData.timing - initialTiming, ...Object.values(differences)]);

        await connection.execute(insertQuery, [saison, manche, newData.timing - initialTiming, ...Object.values(differences), ...Object.values(differences)]);
    }
}

// Fonction pour lire et traiter un fichier
async function processFile(filePath) {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const match = data.match(/ntt_f\((.*)\);/);
    
    if (!match) throw new Error('Impossible de trouver l\'appel ntt_f dans ' + filePath);
    
    const argsString = match[1];
    const args = eval(`[${argsString}]`);
    
    const [
        tdb1,
        timing,
        [race_status, tdb2, temps_restant],
        [sec, temperature_piste, temperature_air, humidite, sens_vent, vitesse_vent, pression],
        lignes
    ] = args;

    // Construire l'objet JSON
    const result = {
        tdb1,
        timing,
        race_status,
        tdb2,
        temps_restant,
        sec,
        temperature_piste,
        temperature_air,
        humidite,
        sens_vent,
        vitesse_vent,
        pression,
        lignes: lignes.map((ligne, index) => {
            const [
                abandon, tours, temps_tour, position, gap, interval, pit, tbd1, vitesse, rapport, tbd2, drs, tbd3, tpm,
                pneus, gps1, gps2, s1, s2, s3
            ] = ligne;

            const dernierPneu = pneus[pneus.length - 1];

            return {
                timing,
                numero: pilotes[index],
                abandon,
                tours,
                temps_tour,
                position,
                gap,
                interval,
                pit,
                pneus: {
                    type: dernierPneu[0],
                    tours: dernierPneu[1]
                },
                gps1: {
                    x1: gps1[0],
                    y1: gps1[1],
                    x2: gps1[2],
                    y2: gps1[3]
                },
                gps2: {
                    x1: gps2[0],
                    y1: gps2[1],
                    x2: gps2[2],
                    y2: gps2[3]
                },
                s1,
                s2,
                s3
            };
        })
    };

    return result;
}

// Fonction principale
async function main() {
    const connection = await mysql.createConnection(dbConfig);

    try {
        // Lire et traiter tous les fichiers state*.js dans le répertoire
        //const files = await fs.promises.readdir(directoryPath);
        const files = await checkAndExtractDirectory(directoryPath);
        const stateFiles = files.filter(file => file.startsWith('state') && file.endsWith('.js')).sort();
        const initialTiming = parseInt(stateFiles[0].replace(/state_(\d+)_(\d+)\.js/, (_, num1, num2) => `${num1}${num2}`));        

        let previousData = null;

        for (const file of stateFiles) {
            const filePath = path.join(directoryPath, file);
            const currentData = await processFile(filePath);
            
            if (previousData) {
                await compareAndInsert(connection, currentData, previousData, initialTiming);
            }
            previousData = currentData; // Mettre à jour pour la prochaine comparaison
        }
    } catch (error) {
        console.error('Erreur:', error);
    } finally {
        await connection.end();
    }
}

main();
