const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises
const unzipper = require('unzipper');
const { checkAndExtractDirectory, formatTime } = require('./utils');
const { log, clear } = require('console');

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];
const manche = process.argv[3];

if (!saison || !manche) {
    console.error('Erreur : vous devez fournir la saison et la manche en paramètres.');
    console.error('Usage : node script.js <saison> <manche>');
    process.exit(1);
}

// Configuration de la connexion à la base de données
const dbConfig = {
    host: 'localhost',     // Remplacez par votre hôte
    user: 'root', // Remplacez par votre nom d'utilisateur
    password: '', // Remplacez par votre mot de passe
    database: 'f1-history'  // Remplacez par le nom de votre base de données
};

// Fonction pour comparer et insérer dans la base de données
async function compareAndInsert(connection, newData, oldData, initialTiming, data) {
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
            if (newItem.tours !== oldItem.tours && data.toursMax < newItem.tours) {
                console.log('Tours effectués : ' + newItem.tours + '/' + data.nbTours);
                data.toursMax = newItem.tours;
                if (newItem.tours < data.nbTours)
                    differences.current_lap = newItem.tours + 1;
            }
            if (newItem.gap !== oldItem.gap) differences.gap = newItem.gap;
            if (newItem.drs !== oldItem.drs) differences.drs = newItem.drs;
            if (newItem.interval !== oldItem.interval) differences.interval = newItem.interval;
            if (newItem.temps_tour !== oldItem.temps_tour) differences.temps_tour = newItem.temps_tour;
            if (newItem.s1 !== oldItem.s1) differences.s1 = newItem.s1;
            if (newItem.s2 !== oldItem.s2) differences.s2 = newItem.s2;
            if (newItem.s3 !== oldItem.s3) differences.s3 = newItem.s3;
            if (newItem.pit !== oldItem.pit) differences.pit = newItem.pit;
            if (newItem.abandon !== oldItem.abandon) differences.abandon = newItem.abandon;

            if (differences.s1 == 0) differences.s1 = ''; else if(differences.s1 !== undefined) differences.s1 = differences.s1.toFixed(3);
            if (differences.s2 == 0) differences.s2 = ''; else if(differences.s2 !== undefined) differences.s2 = differences.s2.toFixed(3);
            if (differences.s3 == 0) differences.s3 = ''; else if(differences.s3 !== undefined) differences.s3 = differences.s3.toFixed(3);
            if (differences.gap == 0) differences.gap = ''; else if (!isNaN(differences.gap)) differences.gap = differences.gap.toFixed(1);
            if (differences.gap < 0) differences.gap = parseInt(0 - differences.gap) + ' LAP';
            if (differences.interval < 0) differences.interval = parseInt(0 - differences.interval) + ' LAP';
            if (differences.interval == 0) differences.interval = ''; else if (!isNaN(differences.interval)) differences.interval = differences.interval.toFixed(3);
            if (newItem.position > oldItem.position || newItem.abandon === 1) {differences.interval = '';}

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

        await connection.execute(insertQuery, [saison, manche, newData.timing - initialTiming, ...Object.values(differences), ...Object.values(differences)]);
    }
}

// Fonction pour lire et traiter un fichier
async function processFile(filePath, pilotes) {
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
                drs,
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

async function extractFromTfeed(connection, saison, manche) {
    const directoryPath = `./tfeed-data/${saison}-${manche}`;
    const pilotes = await getNumeros(connection, saison, manche);    
    const nbPilotes = pilotes.length;

    // Lire et traiter tous les fichiers state*.js dans le répertoire
    const files = await checkAndExtractDirectory(directoryPath);
    const stateFiles = files.filter(file => file.startsWith('state') && file.endsWith('.js')).sort();
    const initialTiming = parseInt(stateFiles[0].replace(/state_(\d+)_(\d+)\.js/, (_, num1, num2) => `${num1}${num2}`));
    
    
    // Création des infos générales
    const modele = nbPilotes % 2 === 0 ? nbPilotes : nbPilotes + 1;
    insertLiveTiming(connection, saison, manche, true, true, true, modele);

    let previousData = null;
    let nbTours = await getNbTours(saison, manche, connection);
    let data = {
        toursMax: 0,
        nbTours: nbTours
    };

    for (const file of stateFiles) {
        const filePath = path.join(directoryPath, file);
        const currentData = await processFile(filePath, pilotes);
        const nbLignes = Object.keys(currentData.lignes).length;        
        if (nbLignes !== nbPilotes) {
            console.log(`Erreur : il y a ${nbLignes} dans les fichiers de data Live Timing et ${pilotes.length} pilotes trouvés en BDD. Interruption du process`);
            process.exit();
        }

        if (previousData) {
            await compareAndInsert(connection, currentData, previousData, initialTiming, data);
        } else {
            for (const ligne of currentData.lignes) {
                const numero = ligne.numero;
                const position = ligne.position;
                const pneus = ligne.pneus.type;

                const insertQuery = `INSERT INTO live_timing_init (saison, manche, numero, position, pneus) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE position=?, pneus=?`;
                await connection.execute(insertQuery, [saison, manche, numero, position, pneus, position, pneus]);
            }
            console.log(`Ecriture des pilotes OK`);
        }
        previousData = currentData; // Mettre à jour pour la prochaine comparaison
    }
}

async function compareAndInsertOrUpdateDifferences(oldItems, newItems, connection, timing, nbTours) {
    // Crée un dictionnaire des oldItems pour les retrouver facilement par numero
    const oldItemsDict = oldItems.reduce((acc, item) => {
      acc[item.numero] = item;
      return acc;
    }, {});
  
    for (const newItem of newItems) {
      const oldItem = oldItemsDict[newItem.numero];
  
      if (oldItem) {
        const changes = {};
        
        // Comparer chaque attribut
        for (const key of Object.keys(newItem)) {
          if (newItem[key] !== oldItem[key]) {
            changes[key] = newItem[key];
          }          
        }
        if (changes.position) {
            changes.timing = timing;
        }
        if (newItem.tours != oldItem.tours && newItem.position == 1) {
            if (newItem.tours < nbTours) {
                changes.current_lap = newItem.tours + 1;
            } else {
                changes.race_status = 9;
            }
        }
  
        // Si des différences sont trouvées, les insérer ou mettre à jour dans la table live_timing_event
        if (Object.keys(changes).length > 0) {
            
                const columns = ['numero', ...Object.keys(changes).map(col => `\`${col}\``)].join(',');
                const values = [newItem.numero, ...Object.values(changes)];
                const placeholders = values.map(() => '?').join(',');
        
                // Créer la clause ON DUPLICATE KEY UPDATE
                const updates = Object.keys(changes)
                .map(key => `\`${key}\` = VALUES(\`${key}\`)`)
                .join(', ');
        
                await connection.execute(
                  `INSERT INTO live_timing_event (saison, manche, ${columns}) VALUES (${saison}, ${manche}, ${placeholders})
                   ON DUPLICATE KEY UPDATE ${updates}`,
                  values
                );
        }
      }
    }
  }

  function recalculPosition(data) {
    // Filtrer les données pour ne garder que celles avec un temps de tour défini
  const filteredData = data;

  const timingDebug = data.find(item => item.numero === 1).timing;

  // Trier les données par tours décroissant, secteursParcourus décroissant, et timing croissant
  filteredData.sort((a, b) => {
    if (b.tours !== a.tours) {
      return b.tours - a.tours; // Tri décroissant par tours
    }
    if (b.secteursParcourus !== a.secteursParcourus) {
      return b.secteursParcourus - a.secteursParcourus; // Tri décroissant par secteursParcourus
    }
    if (b.timing !== a.timing) {
        return a.timing - b.timing; // Tri croissant par timing
      }
    return a.grille - b.grille; // Tri croissant par grille
  });

  // Créer un tableau pour garder les positions uniques
  const result = [];
  let lastPosition = null;

  filteredData.forEach((item, index) => {
      // Sinon, attribuer une nouvelle position unique
      item.position = index + 1;
      if (item.tours !=0 || item.secteursParcourus == 0)
        lastPosition = item.position; // Mettre à jour la dernière position utilisée      
    result.push(item);
  });
clear
  
  // Réunir les données traitées avec les données sans temps de tour
  return [...result];
  }

async function extractFromLapTimes(connection, saison, manche) {

    const newPiloteClassement = {pilote: {}};
    const oldPiloteClassement = {pilote: {}};
    let newSortedClassement = [];
    let oldSortedClassement = [];
    let oldItems = [];
    let newItems = [];
    const nbTours = await getNbTours(saison, manche, connection);

    // Grille de départ
    const grilleDepart = await getGrilleDepart(connection, saison, manche);
    for (const pilote of grilleDepart) {
        let insertQuery = `INSERT INTO live_timing_init (saison, manche, numero, position) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE position=?`;
        await connection.execute(insertQuery, [saison, manche, pilote.numero, pilote.position, pilote.position]);
        oldPiloteClassement.pilote[pilote.numero] = {position: pilote.position }
        newItems[pilote.numero] = {numero: pilote.numero, position: pilote.position, timing: 0, tours: 0, 
            secteursParcourus: 0, s1:null, s2:null, s3:null, temps_tour:null, grille: pilote.position, gap: '', interval: '' };
        // Insertion du premier event
        insertQuery = `INSERT INTO live_timing_event (saison, manche, numero, timing, position) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE position=?`;
        await connection.execute(insertQuery, [saison, manche, pilote.numero, 0, pilote.position, pilote.position]);
    };
    // Initialisation de oldItems et newItems
    oldItems = JSON.parse(JSON.stringify(newItems)).filter(item => item !== null);
    newItems = newItems.filter(item => item !== null);

    // Création des infos générales
    insertLiveTiming(connection, saison, manche, false, false, false, grilleDepart.length);

    
    const tempsTour = await getTempsTour(connection, saison, manche);
    for (const temps of tempsTour) {
        // Calcul du secteur
        let secteursParcourus = 0;
        if (temps.s1 !== null && temps.s2 === null) {
            secteursParcourus = 1;
        }
        if (temps.s2 !== null && temps.s3 === null) {
            secteursParcourus = 2;
        }
        // Récupération des infos dans newPiloteClassement
        let itemToUpdate = newItems.find(item => item.numero === temps.numero);
        itemToUpdate.timing = parseFloat(temps.temps_total) * 1000;
        itemToUpdate.tours = temps.tour;
        itemToUpdate.secteursParcourus = secteursParcourus;
        itemToUpdate.s1 = temps.s1;
        itemToUpdate.s2 = temps.s2;
        itemToUpdate.s3 = temps.s3;
        itemToUpdate.temps_tour = temps.temps_tour;
        // Si changement de position, on recalcul les positions
        newItems = recalculPosition(newItems);
        // Calcul du gap
        itemToUpdate = newItems.find(item => item.numero === temps.numero);
        if (itemToUpdate.position != 1) {
            const itemPremier = newItems.find(item => item.position === 1);
            const itemPrecedent = newItems.find(item => item.position === itemToUpdate.position - 1);    
            itemToUpdate.gap = calculEcart(itemToUpdate, itemPremier);
            itemToUpdate.interval = calculEcart(itemToUpdate, itemPrecedent);
        }
        await compareAndInsertOrUpdateDifferences(oldItems, newItems, connection, itemToUpdate.timing, nbTours);
        // On met à jour oldItems
        oldItems = JSON.parse(JSON.stringify(newItems)).filter(item => item !== null);
    }
    
}

function calculEcart(itemPilote, itemPiloteReference) {
    let ecart;
    if (itemPilote.tours === itemPiloteReference.tours) {
        ecart = ((itemPilote.timing - itemPiloteReference.timing) / 1000).toFixed(3);
    } else {
        ecart = `${itemPiloteReference.tours - itemPilote.tours} LAP`; 
    }
    return ecart;
}

// Fonction principale
async function main() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        if (saison <= 2006) {
            await extractFromLapTimes(connection, saison, manche);
        }
        if (saison >= 2010) {
            await extractFromTfeed(connection, saison, manche);
        }        
    } catch (error) {
        console.error('Erreur:', error);
    } finally {
        await connection.end();
    }
}

async function getNbTours(saison, manche, connection) {
    try {
      // Exécution de la requête SELECT avec les paramètres saison et manche
      const [rows] = await connection.execute(
        'SELECT tours FROM statsf1_grand_prix WHERE saison = ? AND manche = ?',
        [saison, manche]
      );
  
      // Vérification si un résultat a été retourné
      if (rows.length > 0) {
        return rows[0].tours; // Retourne la valeur unique de "tours"
      } else {
        return null; // Retourne null si aucun résultat trouvé
      }
    } catch (error) {
      console.error('Erreur lors de la récupération de la valeur:', error);
      throw error;
    }
  }

  async function getNumeros(connection, saison, manche) {
    const query = `
        SELECT DISTINCT numero 
        FROM statsf1_classement sc
        LEFT JOIN statsf1_grand_prix sgp ON sgp.id_grand_prix = sc.id_grand_prix
        WHERE saison = ? AND manche = ?
        AND sc.position_int <= 55
        ORDER BY numero
    `;

    try {
        const [rows] = await connection.execute(query, [saison, manche]);
        return rows.map(row => row.numero);
    } catch (error) {
        console.error('Erreur lors de l\'exécution de la requête :', error);
        throw error;
    }
}

async function getTempsTour(connection, saison, manche) {
  const query = `
    SELECT numero, tour, position, temps_total as timing, s1, s2, s3, temps_tour, temps_total
    FROM tour_par_tour tpt
    WHERE saison = ? AND manche = ?
    AND temps_total <> 0
    order by temps_total;
  `;
  
  try {
    const [rows] = await connection.execute(query, [saison, manche]);
    
    // Transforme les résultats en JSON
    const result = rows.map(row => ({
      numero: row.numero,
      tour: row.tour,
      position: row.position,
      timing: row.timing,
      s1: row.s1,
      s2: row.s2,
      s3: row.s3,
      temps_tour: row.temps_tour,
      temps_total: row.temps_total
    }));
    
    return result; // Retourne le tableau d'objets JSON
  } catch (error) {
    console.error('Erreur lors de l\'exécution de la requête:', error);
    throw error;
  }
}

async function getGrilleDepart(connection, saison, manche) {
    try {
        // Exécution de la requête SQL
        const [rows] = await connection.execute(`
            SELECT position, numero, UPPER(sp.nom) AS pilote
            FROM old_grille og
            LEFT JOIN statsf1_pilote sp ON sp.nom_url = og.id_pilote_statsf1
            WHERE saison = ? AND manche = ?
            ORDER BY position
        `, [saison, manche]);

        // Retourne les résultats sous forme d'objet JSON
        const result = rows.map(row => ({
            position: row.position,
            numero: row.numero,
            pilote: row.pilote
        }));

        return result;

    } catch (error) {
        console.error('Erreur lors de l\'exécution de la requête :', error);
    }
}

async function insertLiveTiming(connection, saison, manche, secteurs, drs, pneus, modele) {
    try {
        const insertQuery = `
            INSERT INTO live_timing (saison, manche, secteurs, drs, pneus, modele)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                secteurs = VALUES(secteurs), 
                drs = VALUES(drs), 
                pneus = VALUES(pneus), 
                modele = VALUES(modele)
        `;

        // Exécution de la requête avec les paramètres
        await connection.execute(insertQuery, [saison, manche, secteurs, drs, pneus, modele]);

    } catch (error) {
        console.error('Erreur lors de l\'insertion dans la table live_timing:', error);
    }
}

async function triClassement(classement) {
    let sortedClassement = Object.entries(classement.pilote).sort(([, a], [, b]) => {
        // Tri par 'tours' décroissant
        if (b.tours !== a.tours) return b.tours - a.tours;
        // Si égalité, tri par 'secteursParcourus' décroissant
        if (b.secteursParcourus !== a.secteursParcourus) return b.secteursParcourus - a.secteursParcourus;
        // Si encore égalité, tri par 'temps_total' croissant
        return parseFloat(a.temps_total) - parseFloat(b.temps_total);
      });

      //return { pilote: Object.fromEntries(sortedClassement) };
      sortedClassement = sortedClassement.map(([_, value]) => value);

      let position = 1;
      sortedClassement.forEach(element => {
        element.position = position++;
      });
      
    return sortedClassement
}

main();
