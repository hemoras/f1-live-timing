const fs = require('fs');
const path = require('path');

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];  // Premier paramètre : saison
const manche = process.argv[3];  // Deuxième paramètre : manche

if (!saison || !manche) {
    console.error('Erreur : vous devez fournir la saison et la manche en paramètres.');
    console.error('Usage : node script.js <saison> <manche>');
    process.exit(1);
}

// Construire le chemin du répertoire basé sur la saison et la manche
const directoryPath = `./${saison}-${manche}`;

// Tableau des numéros des pilotes
const pilotes = [2, 3, 5, 7, 8, 9, 11, 14, 18, 19, 20, 26, 27, 30, 31, 33, 44, 55, 77, 94];

// Fonction pour lire et traiter un fichier
function processFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject('Erreur lors de la lecture du fichier: ' + err);
            }

            // Extraire les arguments passés à la fonction ntt_f
            const match = data.match(/ntt_f\((.*)\);/);
            if (!match) {
                return reject('Impossible de trouver l\'appel ntt_f dans ' + filePath);
            }

            // Parser les arguments de la fonction
            const argsString = match[1];

            try {
                // Transformer les données en un tableau d'arguments JavaScript valide
                const args = eval(`[${argsString}]`);

                // Extraire les données de manière structurée
                const [
                    race_status, // 8
                    timing,     // 1493554050642
                    [tdb1, tdb2, temps_restant], // [4,1,7148]
                    [sec, temperature_piste, temperature_air, humidite, sens_vent, vitesse_vent, pression], // [0,41,26,32,204,1.4,1012.0]
                    lignes // Table des lignes
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

                        // Extraire uniquement le dernier élément de la liste "pneus"
                        const dernierPneu = pneus[pneus.length - 1];

                        return {
                            numero: pilotes[index], // Ajouter le numéro du pilote depuis le tableau "pilotes"
                            abandon,
                            tours,
                            temps_tour,
                            position,
                            gap,
                            interval,
                            pit,
                            tbd1,
                            vitesse,
                            rapport,
                            tbd2,
                            drs,
                            tbd3,
                            tpm,
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

                resolve(result);
            } catch (err) {
                reject('Erreur lors du traitement des données dans ' + filePath + ': ' + err);
            }
        });
    });
}

// Lire et traiter tous les fichiers state*.js dans le répertoire
fs.readdir(directoryPath, (err, files) => {
    if (err) {
        return console.error('Impossible de lire le répertoire:', err);
    }

    // Filtrer les fichiers qui correspondent au motif "state*.js" et les trier par ordre alphabétique
    const stateFiles = files.filter(file => file.startsWith('state') && file.endsWith('.js')).sort();

    // Traiter chaque fichier un par un
    stateFiles.forEach(file => {
        const filePath = path.join(directoryPath, file);
        processFile(filePath)
            .then(result => {
                // Afficher ou sauvegarder le résultat pour chaque fichier
                console.log(`Fichier ${file} traité avec succès.`);
                const outputFilePath = `output_${file.replace('.js', '.json')}`;
                fs.writeFile(outputFilePath, JSON.stringify(result, null, 2), (err) => {
                    if (err) {
                        console.error(`Erreur lors de l'écriture du fichier JSON ${outputFilePath}:`, err);
                    } else {
                        console.log(`Fichier JSON créé avec succès : ${outputFilePath}`);
                    }
                });
            })
            .catch(error => {
                console.error('Erreur:', error);
            });
    });
});
