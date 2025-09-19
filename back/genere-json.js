const fs = require('fs').promises;
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises
const path = require('path');
const { checkAndExtractDirectory, formatTime } = require('./utils');

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];
const manche = process.argv[3];
const startIndex = parseInt(process.argv.indexOf('-start'));
const debug = parseInt(process.argv.indexOf('-debug'));
let start = 0;
if (startIndex !== -1 && process.argv[startIndex + 1]) {
    start = parseInt(process.argv[startIndex + 1], 10); // Convertir en entier
}

if (!saison || !manche) {
    console.error('Script de génération du fichier json en utilisant les events des tables live_timing_event et live_timing_event_additionnel');
    console.error('Usage : node script.js <saison> <manche> [-start <duree_en_minutes>]');
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
    const InfosGenerales = await getInfosGenerales(connection, saison, manche);    
    let courseEn2Manches = false;
    let manche1EnCours = false;
    let manche2EnCours = false;

    console.log(`Durée du décompte : ${start} minutes`);

    
    let startEvents = { events: [] };
    // La durée de pré course correspond au premier event additionnel (normalement un tour de formation, éventuellement une SC)
    dureePreCourseMillis = - InfosGenerales.premier_event + start * 60 * 1000;

    // Création du décompte
    if (start !== 0) {
        startEvents.events.push({timing:0, type: "general", race_status:{texte:start*60, css:"decompte"}});       
    }    
    
    try {
        // Requête pour récupérer les lignes correspondant à la saison et la manche, triées par timing
        const [rows] = await connection.execute(
            `
            (SELECT 'event' as type_event, id, saison, manche, numero, timing, race_status, current_lap, \`position\`, pneus, drs, pneus_tours, tours, gap, \`interval\`, temps_tour, s1, s2, s3, pit, abandon
             FROM live_timing_event WHERE saison = ? AND manche = ?)
            UNION
            (SELECT 'event_additionnel' as type_event, id, saison, manche, numero, timing, race_status, current_lap, \`position\`, pneus, drs, pneus_tours, tours, gap, \`interval\`, temps_tour, s1, s2, s3, pit, abandon
            FROM live_timing_event_additionnel WHERE saison = ? AND manche = ?)
            ORDER BY timing`, 
            [saison, manche, saison, manche]
        );

        // Iniatialisation des meilleurs tours / secteurs
        let newEvents = { events: [] };
        let couleurs = { tour: {}, s1:{}, s2: {}, s3: {} };
        let blap = {}; let s1 = {}; let s2 = {}; let s3 = {};

        const general = {"nbTours": InfosGenerales.tours_prevus, "nom_gp": saison + ' ' + InfosGenerales.nom_gp, "secteurs": InfosGenerales.secteurs, "drs": InfosGenerales.drs, "pneus": InfosGenerales.pneus, "modele": InfosGenerales.modele};
        const pilotes = await createInitData(saison, manche, connection);

        let timingDepart2 = 0; // Renseigné uniquement si les tours du premier départ s'ont pas été comptabilisés
        let classementPartie1 = null;
        
        // Course en 2 manches
        if (InfosGenerales.tours_manche1) {
            courseEn2Manches = true;
            classementPartie1 = await getClassementCoursePartie1(saison, manche, connection);            
            manche2EnCours = false;
            manche1EnCours = true;
        }

        if (InfosGenerales.depart2) {
            timingDepart2 = InfosGenerales.depart2 * 1000;
            // Reset si drapeau rouge : 10 minutes avant le départ 2            
            newEvents.events.push({"timing":timingDepart2 - 10000*60, "type": "general", "reset": true});
        }

        // Parcours de toutes les lignes de la table live_timing_event        
        const events = rows.map(row => { 
            let showLog = false;
            row.timing_original = row.timing;
            if (row.timing === 240171) {
                showLog = true;
            }
            if (courseEn2Manches && row.type_event === 'event') {
                // Si course 2 manches sur un tour de la première manche
                if (manche1EnCours || !row.numero) {
                    // Si on rencontre un changement de tour qui n'est pas dans la manche 1 d'après classementPartie1, on termine la manche 1 pour tous les évennements qui vont suivre
                    if (parseInt(row.temps_tour) !== 0 && row.tours && classementPartie1 && classementPartie1.find(p => p.numero === row.numero) && row.tours > classementPartie1.find(p => p.numero === row.numero).tours) {
                        manche1EnCours = false; 
                        manche2EnCours = true;  
                    } else {
                        row.timing = parseInt(row.timing) + dureePreCourseMillis;
                    }                    
                }
                // Si course 2 manches sur un tour de la seconde manche       
                if (manche2EnCours && row.numero) {
                    row.timing = parseInt(row.timing) + timingDepart2 + dureePreCourseMillis - classementPartie1.find(p => p.numero === row.numero).temps_total;
                }
            } else { // Cas normal : Course en une seule manche ou timing additionnel                
                if (row.type_event === 'event_additionnel') { // Si c'est une course en 2 manches, c'est que c'est un temps additionnel, on n'ajoute pas timingDepart2
                    row.timing = parseInt(row.timing) + dureePreCourseMillis;
                }                 
                else { // Course en 1 seule manche (avec ou sans drapeau rouge)
                    if (row.timing === 0) {
                        row.timing = parseInt(row.timing) + dureePreCourseMillis;
                    } else {
                        row.timing = parseInt(row.timing) + dureePreCourseMillis + timingDepart2;   
                    }                    
                }                
            }
            if (showLog) {
                showLog = false;
            }
            
            // Création de l'event
            const event = { timing: row.timing, timing_original: row.timing_original };
            if (row.numero !== null) {
                event.type = 'pilote';
                event.numero = row.numero;
            } else {
                event.type = 'general';
            }


            // Ajout de chaque champ non null
            Object.keys(row).forEach(key => {
                if (row[key] !== null && key !== 'id' && key !== 'saison' && key !== 'manche' && key !== 'numero' && key !== 'timing') {
                    if (key === 'abandon') {
                        if (row[key] == 1) event.tour = {"valeur": "STOP", "couleur": "red"};
                        if (row[key] == 2) event.tour = {"valeur": "PIT", "couleur": "red"};
                        if (row[key] == 3) event.tour = {"valeur": "OUT", "couleur": "red"};
                        if (row[key] == 9) event.tour = {"valeur": "RETIRED", "couleur": "red"};
                        if (row[key] == 1 || row[key] == 9) {event.interval = ''; event.gap = ''; event.pit = '';}
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
                        if (time !== 0 && (! blap?.best || blap?.best > time)) {
                            blap.best = time;
                            blap[event.numero] = time;
                            couleur = 'purple';
                            // Si il y a un autre pilote en purple, on le repasse en vert
                            const purpleTrouve = Object.entries(couleurs.tour).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve && purpleTrouve != row.numero) {
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "tour": {"couleur": "green"}});
                                couleurs.tour[parseInt(purpleTrouve)] = 'green';                                
                            }    
                            // On met à jour le temps du meilleur tour global
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "best_lap", "temps": formatTime(time), "numero": row.numero, "tour": row.tours});
                            // On met à jour le meilleur tour du pilote en cours
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": row.numero, "best_lap": formatTime(time)});
                        } else if (time !== 0  && (!blap[event.numero] || blap[event.numero] > time) && row.timing > InfosGenerales.depart2 * 1000) {
                            if (event.numero === 5) console.log(`depart2=${InfosGenerales.depart2}, timinh=${row.timing}, tour=${row.tours}, time=${time}, blap.best=${blap?.best}, blap[event.numero]=${blap[event.numero]}, blap?.best=${blap?.best}, row[key]=${row[key]}`);
                            blap[event.numero] = time;
                            couleur = 'green';
                            // On met à jour le meilleur tour du pilote en cours
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": row.numero, "best_lap": formatTime(time)});
                        }
                        if (row.tours == 1) couleur = 'white';
                        if (time !== 0) event.tour = {"valeur": formatTime(row[key]), "couleur": couleur};
                        else event.tour = {"valeur": '', "couleur": couleur};
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
                    } else if (key === 'position' && row[key] === 1) {
                        event.position = 1;
                        event.gap = '';
                        event.interval = '';
                    } else if (key !== 'type_event')
                        event[key] = row[key];
                }
            });

            return event;
        });

        let mergedEvents = events.concat(startEvents.events).concat(newEvents.events).sort((a, b) => a.timing - b.timing);

        const groupedEvents = mergedEvents.reduce((acc, event) => {
            // Trouver un groupe avec le même timing
            const existingGroup = acc.find(e => e.timing === event.timing);
          
            if (existingGroup) {
              // Ajouter l'événement au groupe existant
              existingGroup.event.push(event);
            } else {
              // Créer un nouveau groupe avec cet événement
              acc.push({
                timing: event.timing,
                event: [event],
                timing_original: event.timing_original
              });
            }
          
            return acc;
          }, []);
          groupedEvents.forEach(group => {
            group.event.forEach(e => {
              delete e.timing;
            });
          });

        const result = { general, pilotes, events: groupedEvents };
        const filePath = path.join(__dirname, '..\\front\\public\\data', `${saison}_${manche}.json`);
        
        // Écriture du fichier JSON
        await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
        console.log(`Fichier JSON généré avec succès : ${filePath}`);
        if (debug !== -1 && debug) await creerDebugJson(saison, manche);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des données:', error);
    } finally {
        await connection.end();
    }
}

async function creerDebugJson(saison, manche) {
    const inputFile = path.join(__dirname, '..\\front\\public\\data',`${saison}_${manche}.json`);
    const outputFile = path.join(__dirname, '..\\front\\public\\data',`${saison}_${manche}-debug.json`);

    const contenu = await fs.readFile(inputFile, 'utf8');
    const data = JSON.parse(contenu);

    // Modifier les timings des events
    data.events = data.events.map((event, index) => {
    return {
        ...event,
        timing: index * 500,
        vrai_timing: event.timing
    };
    });

    // Sauvegarder dans un nouveau fichier
    await fs.writeFile(outputFile, JSON.stringify(data, null, 2), 'utf8');

    console.log(`Fichier debug sauvegardé sous ${outputFile}`);
}

async function createInitData(saison, manche, connection) {
    const [rows] = await connection.execute(
        `SELECT lti.\`position\`, lti.numero, upper(sp.nom) as pilote, upper(sp.prenom) as prenom, ltpc.affichage as pneu, ltpc.couleur 
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

    // Ajout de l'initiale du prénom si homonymes
    for (const row of rows) {
        if (row.pilote == 'SCHUMACHER' && saison >= 1997 && saison <= 2006) {
            row.pilote = row.prenom[0] + ' ' + row.pilote;
        }
        if (row.pilote == 'SUZUKI' && saison == 1993 && manche >= 15) {
            row.pilote = row.prenom[0] + ' ' + row.pilote;
        }
    }

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

async function getClassementCoursePartie1(saison, manche, connection) {
    const [rows] = await connection.execute(`
        SELECT numero, temps_total, tours
        from live_timing_manche1 ltm 
        where saison = ? and manche = ?
    `, [saison, manche]);

    // Formater les résultats sous forme d'objet JSON
    const result = rows.map(row => ({
        numero: row.numero,
        temps_total: row.temps_total * 1000,
        tours: row.tours
    }));

    return result;
}

  async function getInfosGenerales(connection, saison, manche) {
    try {
        const query = `
            SELECT lt.saison, lt.manche, lt.nom_gp, lt.secteurs , lt.modele , lt.arrivee , lt.tours_manche1 , lt.tours_prevus, 
                lt.secteurs , lt.drs , lt.pneus, lt.depart2, min(a.timing) as premier_event
            FROM live_timing lt
            LEFT JOIN live_timing_event_additionnel a on a.saison = lt.saison and a.manche = lt.manche 
            WHERE lt.saison = ? AND lt.manche = ?
            GROUP BY lt.saison, lt.manche, lt.nom_gp, lt.secteurs , lt.modele , lt.arrivee , lt.tours_manche1 , lt.tours_prevus,
                lt.secteurs , lt.drs , lt.pneus, lt.depart2
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
