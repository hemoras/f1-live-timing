const fs = require('fs').promises;
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises
const path = require('path');
const { checkAndExtractDirectory, formatTime } = require('./utils');

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
    user: 'root',          // Remplacez par votre nom d'utilisateur
    password: '',          // Remplacez par votre mot de passe
    database: 'f1-history' // Remplacez par le nom de votre base de données
};

// Fonction principale
async function main() {
    const connection = await mysql.createConnection(dbConfig);

    const pneusList = await getPneusData(saison, connection);
    const raceStatusList = await getAllRaceStatus(connection);
    const nbTours = await getNbTours(saison, manche, connection);
    const InfosGenerales = await getInfosGenerales(connection, saison, manche);
    
    try {
        // Requête pour récupérer les lignes correspondant à la saison et la manche, triées par timing
        const [rows] = await connection.execute(
            `SELECT * FROM live_timing_event WHERE saison = ? AND manche = ? ORDER BY timing`, 
            [saison, manche]
        );

        // Iniatialisation des meilleurs tours / secteurs
        let newEvents = { events: [] };
        let couleurs = { tour: {}, s1:{}, s2: {}, s3: {} };
        let blap = {}; let s1 = {}; let s2 = {}; let s3 = {};

        const general = {"nbTours": nbTours, "secteurs": InfosGenerales.secteurs, "drs": InfosGenerales.drs, "pneus": InfosGenerales.pneus, "modele": InfosGenerales.modele};
        const pilotes = await createInitData(saison, manche, connection);

        const events = rows.map(row => {
            const event = { timing: row.timing };
            if (row.numero !== null) {
                event.type = 'pilote';
                event.numero = row.numero;
            } else {
                event.type = 'general';
            }

            // Ajout de chaque champ non nul
            Object.keys(row).forEach(key => {
                if (row[key] !== null && key !== 'id' && key !== 'saison' && key !== 'manche' && key !== 'numero' && key !== 'timing') {
                    if (key === 'abandon') {
                        if (row[key] == 1) event.tour = {"valeur": "STOP", "couleur": "red"};
                        if (row[key] == 2) event.tour = {"valeur": "PIT", "couleur": "red"};
                        if (row[key] == 3) event.tour = {"valeur": "OUT", "couleur": "red"};
                    }
                    else if (key === 'race_status') {
                        const result = raceStatusList.find(item => item.id_status === row[key]);
                        if (result) {
                            event.race_status = {"texte": result.status, "css": result.css_class};
                        } else {
                            console.log(`status ${row[key]} introuvable`);
                        }
                    }
                    else if (key === 'temps_tour') {
                        let couleur = 'white';
                        let time = parseFloat(row[key]);
                        if (! blap?.best || blap?.best > time) {
                            blap.best = time;
                            blap[event.numero] = time;
                            couleur = 'purple';
                            const purpleTrouve = Object.entries(couleurs.tour).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve) {
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "tour": {"couleur": "green"}});
                                couleurs.tour[parseInt(purpleTrouve)] = 'green';
                            }    
                        } else if (!blap[event.numero] || blap[event.numero] > time) {
                            blap[event.numero] = time;
                            couleur = 'green';
                        }
                        event.tour = {"valeur": formatTime(row[key]), "couleur": couleur};
                        couleurs.tour[event.numero] = couleur; // Pour savoir qui est actuellement en purple
                    } else if (key === 's1') {
                        let couleur = 'white';
                        let time = parseFloat(row[key]).toFixed(3);
                        if (! s1?.best || s1?.best > time) {
                            s1.best = time;
                            s1[event.numero] = time;
                            couleur = 'purple';
                            const purpleTrouve = Object.entries(couleurs.s1).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve) {
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "s1": {"couleur": "green"}});
                                couleurs.s1[purpleTrouve] = 'green';
                            }    
                        } else if (!s1[event.numero] || s1[event.numero] > time) {                            
                            s1[event.numero] = time;
                            couleur = 'green';
                        }
                        event.s1 = {"valeur": row[key], "couleur": couleur};
                        const numero = event.numero;
                        couleurs.s1[numero] = couleur; // Pour savoir qui est actuellement en purple
                    } else if (key === 's2') {
                        let couleur = 'white';
                        let time = parseFloat(row[key]).toFixed(3);
                        if (! s2?.best || s2?.best > time) {
                            s2.best = time;
                            s2[event.numero] = time;
                            couleur = 'purple';
                            const purpleTrouve = Object.entries(couleurs.s2).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve) {
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "s2": {"couleur": "green"}});
                                couleurs.s2[parseInt(purpleTrouve)] = 'green';
                            }
                        } else if (!s2[event.numero] || s2[event.numero] > time) {
                            s2[event.numero] = time;
                            couleur = 'green';
                        }
                        event.s2 = {"valeur": row[key], "couleur": couleur};
                        couleurs.s2[event.numero] = couleur; // Pour savoir qui est actuellement en purple
                    } else if (key === 's3') {
                        let couleur = 'white';
                        let time = parseFloat(row[key]).toFixed(3);
                        if (! s3?.best || s3?.best > time) {
                            s3.best = time;
                            s3[event.numero] = time;
                            couleur = 'purple';
                            const purpleTrouve = Object.entries(couleurs.s3).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve) {
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "s3": {"couleur": "green"}});
                                couleurs.s3[parseInt(purpleTrouve)] = 'green';
                            }
                        } else if (!s3[event.numero] || s3[event.numero] > time) {
                            s3[event.numero] = time;
                            couleur = 'green';
                        }
                        event.s3 = {"valeur": row[key], "couleur": couleur};
                        couleurs.s3[event.numero] = couleur; // Pour savoir qui est actuellement en purple
                    } else if (key === 'pneus') {
                        const pneu = pneusList.pneus.find(p => p.id_pneu === row[key]);
                        if (event.pneus === undefined) event.pneus = {};
                        event.pneus.valeur = pneu.valeur;
                        event.pneus.couleur = pneu.couleur;
                    } else if (key === 'pneus_tours') {
                        if (event.pneus === undefined) event.pneus = {};
                        event.pneus.tours = row[key];
                    }
                    else
                        event[key] = row[key];
                }
            });

            return event;
        });

        //console.log(newEvents);
        //console.log(couleurs.s1);

        let mergedEvents = events.concat(newEvents.events).sort((a, b) => a.timing - b.timing);

        const result = { general, pilotes, events: mergedEvents };
        const filePath = path.join(__dirname, '..\\front\\public\\data', `${saison}_${manche}.json`);
        
        // Écriture du fichier JSON
        await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
        console.log(`Fichier JSON généré avec succès : ${filePath}`);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des données:', error);
    } finally {
        await connection.end();
    }
}


async function createInitData(saison, manche, connection) {
    const [rows] = await connection.execute(
        `SELECT lti.\`position\`, lti.numero, upper(sp.nom) as pilote, ltpc.affichage as pneu, ltpc.couleur 
        from live_timing_init lti
        left join live_timing_pneus ltp on ltp.id_pneu = lti.pneus
        left join live_timing_pneus_couleur ltpc on ltpc.\`type\` = ltp.\`type\` and ltpc.saison = lti.saison 
        left join statsf1_grand_prix sgp on sgp.saison = lti.saison and sgp.manche = lti.manche 
        left join statsf1_classement sc on sc.numero = lti.numero and sc.id_grand_prix = sgp.id_grand_prix 
        left join statsf1_pilote sp on sp.id_pilote = sc.id_pilote 
        where lti.saison=? and lti.manche=?
        order by lti.\`position\``, 
        [saison, manche]
    );

    // Transformation des résultats en objet JSON
    const pilotes = rows.map(row => ({
        numero: row.numero,
        nom: row.pilote,
        pneus: {
            type: row.pneu,
            couleur: row.couleur
        }
    }));

    // Retourne l'objet JSON encapsulé
    return pilotes;
}

async function getAllRaceStatus(connection) {
    try {
      // Exécute la requête pour récupérer toutes les lignes de la table
      const [rows] = await connection.execute('SELECT * FROM live_timing_race_status');
  
      // Retourne les résultats sous forme d'objet JSON
      return rows;
    } catch (error) {
      console.error('Erreur lors de la récupération des données:', error);
      throw error;
    }
  }

async function getPneusData(saison, connection) {
    const [rows] = await connection.execute(`
        SELECT ltp.id_pneu, ltpc.affichage, ltpc.couleur 
        FROM live_timing_pneus_couleur ltpc 
        LEFT JOIN live_timing_pneus ltp ON ltp.\`type\` = ltpc.\`type\` 
        WHERE ltpc.saison = ?;
    `, [saison]);

    // Formater les résultats sous forme d'objet JSON
    const result = rows.map(row => ({
        id_pneu: row.id_pneu,
        valeur: row.affichage,
        couleur: row.couleur
    }));

    return { pneus: result };
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

  async function getInfosGenerales(connection, saison, manche) {
    try {
        const query = `
            SELECT *
            FROM live_timing
            WHERE saison = ? AND manche = ?
        `;
        const [rows] = await connection.execute(query, [saison, manche]);
        
        if (rows.length === 0) {
            console.log(`Aucun enregistrement trouvé pour saison ${saison} et manche ${manche}.`);
        }
        
        return rows[0];
    } catch (error) {
        console.error('Erreur lors de la sélection dans live_timing:', error);
        throw error;
    }
}

main();
