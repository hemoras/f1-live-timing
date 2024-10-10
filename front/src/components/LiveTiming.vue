<template>
    <table class="classement_tfeed">
      <tbody>
      <tr style="border-bottom: 0px;">
        <td colspan="13" style="border-bottom: 0px;">
            <div id="lap_info">LAP <span id="current_lap">1</span> / 2</div>
        </td>
    </tr>
  </tbody>
  </table>
  <table class="classement_tfeed">
  <thead>
    <tr class="modele_22">
      <th style="text-align: right; padding-right: 15px;" id="sort_column">POS</th>
      <th style="text-align: center;">CAR</th>
      <th style="width: 300px;">DRIVER</th>
      <th class="pneus">TYRE</th>
      <th class="tours">LAPS</th>
      <th class="gap">GAP</th>
      <th class="interval">INT</th>
      <th class="temps_tour">LAP TIME</th>
      <th class="secteur">S1</th>
      <th class="secteur">S2</th>
      <th class="secteur">S3</th>
      <th class="pit">PIT</th>
    </tr>
  </thead>
  <transition-group name="slide" tag="tbody">
    <tr v-for="(pilot, index) in sortedPilots" :key="pilot.numero" class="ligne modele_22">
      <td class="position">{{ pilot.position }}</td>
      <td class="numero">{{ pilot.numero }}</td>
      <td class="pilote">{{ pilot.nom }}</td>
      <td :style="{ color: pilot.pneus.couleur }">
        <span class="tyre">{{ pilot.pneus.type }}</span> ({{ pilot.tours }})
      </td>
      <td class="tours">{{ pilot.laps }}</td>
      <td class="gap">{{ pilot.gap }}</td>
      <td class="interval">{{ pilot.interval }}</td>
      <td class="temps_tour">{{ pilot.lapTime }}</td>
      <td :style="{ color: pilot.s1.color }" class="seteur">{{ pilot.s1.value }}</td>
      <td :style="{ color: pilot.s2.color }" class="seteur">{{ pilot.s2.value }}</td>
      <td :style="{ color: pilot.s3.color }" class="seteur">{{ pilot.s3.value }}</td>
      <td>{{ pilot.pit }}</td>
    </tr>
  </transition-group>
</table>

<table class="classement_tfeed" >
  <tbody>
    <tr>
        <td style="border-bottom: 0px;">
            <div id="weather">
                <table>
                  <tbody>
                    <tr>
                        <td style="width:150px;">
                                Track : 30°, Dry
                        </td>
                        <td>
                                Humidity :35%
                        </td>
                        <td>
                                Wind : 6 km/h, 200°
                        </td>
                    </tr>
                    <tr>
                        <td>
                                Air : 28°
                        </td>
                        <td>
                                Pressure : 1025 hPa
                        </td>
                    </tr>
                  </tbody>
                </table>
            </div>
            <div id="timer_secondes" style="display: none;"></div>
            <div id="timer" class="modele_22"></div>
            <div id="race_status" class="green_flag modele_22">TRACK CLEAR</div>
        </td>
    </tr>
  </tbody>
</table>

  </template>
  
  <script>
  export default {
    data() {
      return {
        pilots: [],
        events: [],
        colors: {},
      };
    },
    computed: {
      sortedPilots() {
        return this.pilots.sort((a, b) => a.position - b.position);
      },
    },
    async mounted() {
      await this.loadData();
      this.startEventProcessing();
    },
    methods: {
        async loadData() {
            const responseEvents = await fetch('/events.json');
            const responseConfig = await fetch('/config.json');
            const eventsData = await responseEvents.json();
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
            laps: 0,
            gap: '',
            interval: '',
            lapTime: '',
            s1: { value: '', color: '' },
            s2: { value: '', color: '' },
            s3: { value: '', color: '' },
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

            // Démarrer le traitement des événements
            this.startEventProcessing();
        },
      startEventProcessing() {
        this.events.forEach((event) => {
          setTimeout(() => {
            this.processEvent(event);
          }, event.timing);
        });
      },
      processEvent(event) {
        if (event.type === 'pilote') {
          const pilot = this.pilots.find((p) => p.numero === event.numero);
          if (pilot) {
            if (event.position !== undefined) {
              pilot.position = event.position;
            }
            if (event.tour) {
              pilot.lapTime = event.tour.valeur;
            }
            if (event.S1) {
              pilot.s1.value = event.S1.valeur;
              pilot.s1.color = this.colors[event.S1.couleur];
            }
            if (event.S2) {
              pilot.s2.value = event.S2.valeur;
              pilot.s2.color = this.colors[event.S2.couleur];
            }
            if (event.S3) {
              pilot.s3.value = event.S3.valeur;
              pilot.s3.color = this.colors[event.S3.couleur];
            }
            if (event.tours) {
              pilot.tours = event.tours.valeur;
            }
            if (event.pneus) {
              pilot.pneus.type = event.pneus.valeur;
              pilot.pneus.couleur = event.pneus.couleur;
              pilot.pneus.tours = event.pneus.tours;
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
          }
        }
  
        // Re-trier les pilotes en fonction de leur position
        this.pilots.sort((a, b) => a.position - b.position);
      },
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

th, td {
  padding: 10px; /* Espacement interne */
  border-bottom: 3px solid #bcc2c5; /* Bordure inférieure des cellules */
  color: white; /* Couleur du texte */
  text-align: left; /* Alignement du texte */
}

tr {
  border-top: 3px solid transparent; /* Ajoutez une bordure supérieure transparente pour l'espacement */
}


  </style>
  