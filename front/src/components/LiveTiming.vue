<template>
  <div v-if="fileNotFound">
    <div style="text-align: center; color: white;"><p>Le fichier de données n'est pas disponible pour cette saison et manche.</p></div>
    <!-- Vous pouvez également afficher un composant personnalisé ici -->
    <!-- <ErrorComponent /> -->
  </div>
  <div v-else>
    <div class="container-gauche">
      <div class="nom_gp">{{  nom_gp }}<hr>Round {{  manche }}</div>
    </div>    
      <table class="classement_tfeed">
        <tbody>
        <tr style="border-bottom: 0px;" class="no-background">
          <td colspan="13" style="border-bottom: 0px;">
              <div id="lap_info">LAP <span id="current_lap">{{  current_lap  }}</span> / {{ total_laps }}</div>
          </td>
        </tr>
      </tbody>
      </table>
      <table class="classement_tfeed">
      <thead>
        <tr :class="'modele_'+modele">
          <th style="text-align: right; padding-right: 15px;" id="sort_column">POS</th>
          <th style="text-align: center;">CAR</th>
          <th style="width: 300px;">DRIVER</th>
          <th v-if="affichePneus" class="pneus">TYRE</th>
          <th class="tours">LAPS</th>
          <th v-if="afficheDrs" class="drs">DRS</th>
          <th class="gap">GAP</th>
          <th class="interval">INT</th>
          <th class="temps_tour">LAP TIME</th>
          <th class="temps_tour">BEST LAP</th>
          <th class="secteur" v-if="afficheSecteurs">S1</th>
          <th class="secteur" v-if="afficheSecteurs">S2</th>
          <th class="secteur" v-if="afficheSecteurs">S3</th>
          <th class="pit">PIT</th>
        </tr>
      </thead>
      <transition-group name="slide" tag="tbody">
        <tr v-for="(pilot, index) in sortedPilots" :key="pilot.numero" :class="'ligne modele_'+modele">
          <td class="position">{{ pilot.position }}</td>
          <td class="numero">{{ pilot.numero }}</td>
          <td class="pilote">{{ pilot.nom }}</td>          
          <td v-if="affichePneus" class="pneus">
                <div class="pneu_picto" :style="{ color: pilot.pneus.couleur, border: '2px solid ' + pilot.pneus.couleur }">
                    <span class="pneus_type">{{ pilot.pneus.type }}</span>
                </div>
                <span class="pneus_tours">{{ pilot.pneus.tours }}</span>
            </td>
          <td class="tours">{{ pilot.tours }}</td>
          <td v-if="afficheDrs" class="drs"><div :class="'drs_' + pilot.drs"></div></td>
          <td class="gap">{{ pilot.gap }}</td>
          <td class="interval">{{ pilot.interval }}</td>
          <td :class="'temps_tour lap ' +  pilot.tour.couleur">{{ pilot.tour.valeur }}</td>
          <td :class="'temps_tour lap'">{{ pilot.best_lap }}</td>
          <td v-if="afficheSecteurs" :class="'secteur s1 ' +  pilot.s1.couleur">{{ pilot.s1.valeur }}</td>
          <td v-if="afficheSecteurs" :class="'secteur s2 ' +  pilot.s2.couleur">{{ pilot.s2.valeur }}</td>
          <td v-if="afficheSecteurs" :class="'secteur s3 ' +  pilot.s3.couleur">{{ pilot.s3.valeur }}</td>
          <td class="pit">{{ pilot.pit }}</td>
        </tr>
      </transition-group>
    </table>

    <div id="best_lap">
        <div v-if="best_lap_time !== ''">
              BEST LAP : {{ best_lap_time }} - {{ best_lap_pilote }} ON LAP {{ best_lap_lap }}
        </div>
    </div>

    <table class="classement_tfeed" >
      <tbody>
        <tr class="no-background">
            <td style="border-bottom: 0px;">
                <div id="timer_secondes" style="display: none;"></div>
                <div id="timer" :class="'modele_'+modele"></div>
                <div id="race_status" :class="track_status_css">{{ track_status }}</div>
            </td>
        </tr>
      </tbody>
    </table>
    <div v-if="debug" style="text-align: center; color: white">LAST TIMING : {{  last_timing }}</div>
  </div>
  </template>
  
  <script>
  export default {
    props: {
      saison: {
        type: String,
        required: true
      },
      manche: {
        type: String,
        required: true
      }
    },
    data() {
      return {
        pilots: [],
        events: [],
        colors: {},
        current_lap: 1,
        total_laps: 99,
        track_status: '',
        track_status_css: '',
        last_timing: 0,
        fileNotFound: false,
        afficheSecteurs: 0,
        afficheDrs: 0,
        affichePneus: 0,
        modele: 22,
        nom_gp: '',
        vitesse: 1,
        debug: 0,
        best_lap_time: '',
        best_lap_pilote: '',
        best_lap_lap: '',
        eventsData: {}
      };
    },
    computed: {
      sortedPilots() {
        return this.pilots.sort((a, b) => a.position - b.position);
      },
    },
    async mounted() {
      const vitesseParam = this.$route.query.vitesse;
      if (vitesseParam) {
        this.vitesse = parseInt(vitesseParam, 10); // Convertir en entier
      }
      const debug = this.$route.query.debug;
      if (debug) {this.debug = debug;}
      await this.loadData();
      this.startEventProcessing();
    },
    methods: {
        async loadData() {
          let fichierData =  `${this.saison}_${this.manche}-debug.json`;
          console.log(`/data/${fichierData}`);
            const responseEvents = await fetch(`/data/${fichierData}`);            
            const responseConfig = await fetch('/config.json');
            try {
              const eventsData = await responseEvents.json();
              this.eventsData = eventsData;

              // affichage des colonnes
              this.afficheSecteurs = eventsData.general.secteurs;
              this.afficheDrs = eventsData.general.drs;
              this.affichePneus = eventsData.general.pneus;
              this.modele = eventsData.general.modele;
              this.nom_gp = eventsData.general.nom_gp;
              console.log(`modele ${this.modele}`);

              const configData = await responseConfig.json();
            
            this.colors = configData.couleurs.reduce((acc, color) => {
            acc[color.id] = color.valeur;
            return acc;
            }, {});

            // Initialiser les pilotes avec les données
            this.pilots = eventsData.pilotes.map((pilot) => ({
            numero: pilot.numero,
            nom: pilot.nom,
            pneus: {
                type: pilot.pneus.type,
                couleur: pilot.pneus.couleur,
                tours: 0
            },
            tours: 0,
            gap: '',
            interval: '',
            tour: { valeur: '', couleur: '' },
            s1: { valeur: '', couleur: '' },
            s2: { valeur: '', couleur: '' },
            s3: { valeur: '', couleur: '' },
            position: 1, // Position initiale (peut être mise à jour par les événements)
            tours: 0, // Tours initiaux
            pit: '', // État du pit
            }));

            // Mettre à jour la position des pilotes
            this.pilots.forEach((pilot, index) => {
            pilot.position = index + 1; // Assigner la position basée sur l'ordre
            });

            // Charger les événements
            this.events = eventsData.events;

            this.total_laps = eventsData.general.nbTours;
            
            // Démarrer le traitement des événements
            this.startEventProcessing();
            } catch {
              this.fileNotFound = true;
            }
        },
      startEventProcessing() {
        this.events.forEach((event) => {
          setTimeout(() => {
            this.processEvent(event);
          }, event.timing / this.vitesse);
        });
      },
      processEvent(events) {

        for (const event of events.event) {
          if (event.type === 'pilote') {
            const pilot = this.pilots.find((p) => p.numero === event.numero);
            if (pilot) {
              if (event.position !== undefined) {
                pilot.position = event.position;
              }
              if (event.tour) {
                //if (event.tour.couleur === 'purple') this.replacePurpleWithGreen('lap');
                if (event.tour.valeur !== undefined) pilot.tour.valeur = event.tour.valeur;
                if (event.tour.couleur) pilot.tour.couleur = event.tour.couleur;
              }
              if (event.s1) {
                //if (event.s1.couleur === 'purple') this.replacePurpleWithGreen('s1');
                if (event.s1.valeur !== undefined) pilot.s1.valeur = event.s1.valeur;
                if (event.s1.couleur) pilot.s1.couleur = event.s1.couleur;
              }
              if (event.s2) {
                //if (event.s1.couleur === 'purple') this.replacePurpleWithGreen('s2');
                if (event.s2.valeur !== undefined) pilot.s2.valeur = event.s2.valeur;
                if (event.s2.couleur) pilot.s2.couleur = event.s2.couleur;
              }
              if (event.s3) {
                //if (event.s3.couleur === 'purple') this.replacePurpleWithGreen('s3');
                if (event.s3.valeur !== undefined) pilot.s3.valeur = event.s3.valeur;
                if (event.s3.couleur) pilot.s3.couleur = event.s3.couleur;
              }
              if (event.tours) {
                pilot.tours = event.tours;
              }
              if (event.pneus) {
                if (event.pneus.valeur) pilot.pneus.type = event.pneus.valeur;
                if (event.pneus.couleur) pilot.pneus.couleur = event.pneus.couleur;
                if (event.pneus.tours) pilot.pneus.tours = event.pneus.tours;
              }
              if (event.drs !== undefined) {
                pilot.drs = event.drs;
              }
              if (event.gap !== undefined) {
                pilot.gap = event.gap;
              }
              if (event.interval !== undefined) {
                pilot.interval = event.interval;
              }
              if (event.pit !== undefined) {
                pilot.pit = event.pit;
              }
              if (event.current_lap !== undefined) {
                this.current_lap = event.current_lap;
              }
              if (event.best_lap !== undefined) {
                console.log("event.best_lap=", event.best_lap);
                pilot.best_lap = event.best_lap;
              }
            }
          } else if (event.type === 'best_lap') {
            this.best_lap_time = event.temps;
            this.best_lap_pilote = this.eventsData.pilotes.find(p => p.numero === event.numero).nom;  
            this.best_lap_lap = event.tour;
          } else {
            if (event.race_status !== undefined) {
              if (event.race_status.css == 'decompte') {
                this.startCountdown(event.race_status.texte, this.vitesse);
              } else {
                this.track_status = event.race_status.texte;
              }              
              this.track_status_css = event.race_status.css;
            }
            if (event.reset) {
              this.pilots.forEach(p => {
                p.tour.valeur = '';
                p.s1.valeur = '';
                p.s2.valeur = '';
                p.s3.valeur = '';
                p.tours = '';
                p.pneus.type = '';
                p.gap = '';
                p.interval = '';
                p.pit = '';
                p.best_lap = '';
              });
              this.current_lap = 0;
            }
          }
        }
  
        // Re-trier les pilotes en fonction de leur position
        this.pilots.sort((a, b) => a.position - b.position);

        this.last_timing = `${events.vrai_timing} [${this.formatDuration(events.vrai_timing)}] (timing original : ${events.timing_original})`;
      },
      formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const paddedMinutes = String(minutes).padStart(2, '0');
        const paddedSeconds = String(seconds).padStart(2, '0');

        if (hours > 0) {
          const paddedHours = String(hours).padStart(2, '0');
          return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
        } else {
          return `${minutes}:${paddedSeconds}`;
        }
      },

      replacePurpleWithGreen(colonne) {
        // Sélectionne tous les <td> qui ont à la fois les classes "s1" et "purple"
        const elements = document.querySelectorAll('td.'+colonne+'.purple');
        
        // Parcourt chaque élément sélectionné
        elements.forEach(td => {
            td.classList.remove('purple'); // Retire la classe "purple"
            td.classList.add('green');     // Ajoute la classe "green"
        });
      },
      startCountdown(seconds, speedMultiplier = 1) {
        let remainingTime = seconds;

        const countdownInterval = setInterval(() => {
            // Calculer les minutes et secondes restantes
            const minutes = Math.floor(remainingTime / 60);
            const secs = remainingTime % 60;

            // Formater pour afficher toujours 2 chiffres
            const formattedMinutes = minutes.toString().padStart(2, '0');
            const formattedSeconds = secs.toString().padStart(2, '0');
            
            // Mettre à jour la propriété track_status
            if (this.track_status_css === 'decompte') {
                this.track_status = `${formattedMinutes}:${formattedSeconds}`;
            }

            // Décrémenter le temps restant
            remainingTime--;

            // Arrêter le décompte à 00:00
            if (remainingTime < 0) {
                clearInterval(countdownInterval);
                if (this.track_status_css === 'decompte') {
                    this.track_status = "00:00";
                }
            }
        }, 1000 / speedMultiplier); // Ajuster l'intervalle en fonction du multiplicateur
    }
      
    },    
  };
  </script>
  
  <style>
  .tyre {
    display: inline-block;
    border: 2px solid;
    border-radius: 70%;
    padding: 1px;
    text-align: center;
  }

  </style>
  