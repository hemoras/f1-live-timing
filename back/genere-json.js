const fs = require('fs').promises;
const mysql = require('mysql2/promise'); // Utiliser mysql2 pour une utilisation avec Promises
const path = require('path');
const { checkAndExtractDirectory, formatTime } = require('./utils');

// Récupérer les paramètres de la ligne de commande (saison et manche)
const saison = process.argv[2];
const manche = process.argv[3];
const startIndex = parseInt(process.argv.indexOf('-start'));
let start = 0;
if (startIndex !== -1 && process.argv[startIndex + 1]) {
    start = parseInt(process.argv[startIndex + 1], 10); // Convertir en entier
}

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

    let dureePreCourse = 0; let dureePreCourseMillis = 0;
    let startEvents = { events: [] };
    // StartIndex contient le nombre de minutes d'avant course : si duree_tdf est renseigné, 
    // c'est le nombre de minutes avant le TDF, sinon, le nombre de minutes avant le départ réel
    if (start) {        
        if (InfosGenerales.duree_tdf) {
            dureePreCourse = (parseFloat(InfosGenerales.duree_tdf) + start * 60);
            startEvents = {events: [
                {timing:0, type: "general", race_status:{texte:start*60, css:"decompte"}},
                {timing:start * 60 * 1000, type: "general", race_status:{texte:"FORMATION LAP", css:"formation_lap"}},
            ]};
        } else {
            dureePreCourse = (start * 60);
            startEvents = {events: [
                {timing:0, event:[{type: "general", race_status:{texte:start*60, css:"decompte"}}]},
            ]}
        }
    }
    dureePreCourseMillis = dureePreCourse * 1000;    
    
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

        const general = {"nbTours": nbTours, "nom_gp": saison + ' ' + InfosGenerales.nom_gp, "secteurs": InfosGenerales.secteurs, "drs": InfosGenerales.drs, "pneus": InfosGenerales.pneus, "modele": InfosGenerales.modele};
        const pilotes = await createInitData(saison, manche, connection);

        let dureeEntreDeuxDeparts = 0; // Renseigné uniquement si les tours du premier départ s'ont pas été comptabilisés
        let classementPartie1 = null;
        // Affichage du drapeau rouge
        if (InfosGenerales.drapeau_rouge) {
            newEvents.events.push({
                timing: dureePreCourseMillis + InfosGenerales.drapeau_rouge * 1000,
                type: "general",
                race_status: {
                    texte: "RED FLAG",
                    css: "red_flag"
                }
            });
            if (InfosGenerales.tours_p1) {
                classementPartie1 = await getClassementCoursePartie1(saison, manche, InfosGenerales.tours_p1, InfosGenerales.timing_depart2, connection);
            }
            dureeEntreDeuxDeparts = InfosGenerales.timing_depart2 * 1000;
            newEvents.events.push({
                timing: dureePreCourseMillis + InfosGenerales.timing_depart2 * 1000,
                type: "general",
                race_status: {
                    texte: "TRACK CLEAR",
                    css: "green_flag"
                }
            });
        }


        const events = rows.map(row => {            
            if (row.timing === 0) {
                row.timing = parseInt(row.timing) + dureePreCourseMillis;
            } else if (classementPartie1 && classementPartie1.find(p => p.numero === row.numero) && row.timing > classementPartie1.find(p => p.numero === row.numero).temps_total) {
                row.timing = parseInt(row.timing) + dureePreCourseMillis + dureeEntreDeuxDeparts - classementPartie1.find(p => p.numero === row.numero).temps_total;
            }
            else if (classementPartie1) {
                row.timing = parseInt(row.timing) + dureePreCourseMillis;
            } else {
                row.timing = parseInt(row.timing) + dureePreCourseMillis + dureeEntreDeuxDeparts;
            }
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
                        if (! blap?.best || blap?.best > time) {
                            blap.best = time;
                            blap[event.numero] = time;
                            couleur = 'purple';
                            // Si il y a un autre pilote en purple, on le repasse en vert
                            const purpleTrouve = Object.entries(couleurs.tour).find(([key, value]) => value === 'purple')?.[0];
                            if (purpleTrouve) {                                
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": parseInt(purpleTrouve), "tour": {"couleur": "green"}});
                                couleurs.tour[parseInt(purpleTrouve)] = 'green';                                
                            }    
                            // On met à jour le temps du meilleur tour global
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "best_lap", "temps": formatTime(time), "numero": row.numero, "tour": row.tours});
                            // On met à jour le meilleur tour du pilote en cours
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": row.numero, "best_lap": formatTime(time)});
                        } else if (!blap[event.numero] || blap[event.numero] > time) {
                            blap[event.numero] = time;
                            couleur = 'green';
                            // On met à jour le meilleur tour du pilote en cours
                            if (row.tours > 1)
                                newEvents.events.push({"timing":row.timing, "type": "pilote", "numero": row.numero, "best_lap": formatTime(time)});
                        }
                        if (row.tours == 1) couleur = 'white';
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
                    } else if (key === 'position' && row[key] === 1) {
                        event.position = 1;
                        event.gap = '';
                        event.interval = '';
                    } else
                        event[key] = row[key];
                }
            });

            return event;
        });

        //console.log(newEvents);
        //console.log('-----------');
        //console.log(startEvents);
        //console.log(couleurs.s1);

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
                event: [event]
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
        
    } catch (error) {
        console.error('Erreur lors de la récupération des données:', error);
    } finally {
        await connection.end();
    }
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

async function getClassementCoursePartie1(saison, manche, tour, timing_depart2, connection) {
    const [rows] = await connection.execute(`
        select numero, if(max(tours)<6,${timing_depart2},sum(temps_tour)) as temps_total
        from live_timing_event
        where saison = ? and manche = ?
        and tours <= ?
        group by numero;
    `, [saison, manche, tour]);

    // Formater les résultats sous forme d'objet JSON
    const result = rows.map(row => ({
        numero: row.numero,
        temps_total: row.temps_total * 1000
    }));

    return result;
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
