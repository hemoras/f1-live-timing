const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];
const manche = process.argv[3];

if (!saison || !manche) {
    console.error('Erreur : vous devez fournir la saison et la manche en paramètres.');
    console.error('Usage : node script.js <saison> <manche>');
    process.exit(1);
}

const directoryPath = `./${saison}-${manche}`;
const pilotes = [2, 3, 5, 7, 8, 9, 11, 14, 18, 19, 20, 26, 27, 30, 31, 33, 44, 55, 77, 94];

// Configuration de la connexion à la base de données
const dbConfig = {
    host: 'localhost',     // Remplacez par votre hôte
    user: 'your_username', // Remplacez par votre nom d'utilisateur
    password: 'your_password', // Remplacez par votre mot de passe
    database: 'your_database'  // Remplacez par le nom de votre base de données
};

// Fonction pour comparer et insérer dans la base de données
async function compareAndInsert(connection, newData, oldData) {
    for (const newItem of newData) {
        const numero = newItem.numero;
        const oldItem = oldData.find(item => item.numero === numero);

        if (oldItem) {
            // Comparaison des champs
            const differences = {};
            if (newItem.position !== oldItem.position) differences.position = newItem.position;
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
                const insertQuery = `INSERT INTO live_timing_event (saison, manche, numero, 
                    ${Object.keys(differences).join(', ')}) VALUES (?, ?, ?, 
                    ${Object.values(differences).map(() => '?').join(', ')})`;
                
                await connection.execute(insertQuery, [saison, manche, numero, ...Object.values(differences)]);
                console.log(`Données insérées pour le numéro ${numero}:`, differences);
            }
        }
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
        race_status,
        timing,
        [tdb1, tdb2, temps_restant],
        [sec, temperature_piste, temperature_air, humidite, sens_vent, vitesse_vent, pression],
        lignes
    ] = args;

    // Construire l'objet JSON
    const result = {
        race_status,
        timing,
        tdb1,
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
        const files = await fs.promises.readdir(directoryPath);
        const stateFiles = files.filter(file => file.startsWith('state') && file.endsWith('.js')).sort();

        let previousData = null;

        for (const file of stateFiles) {
            const filePath = path.join(directoryPath, file);
            const currentData = await processFile(filePath);
            
            if (previousData) {
                await compareAndInsert(connection, currentData.lignes, previousData.lignes);
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
