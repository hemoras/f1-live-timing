<template>
    <div>
      <table class="my-table">
  <thead>
    <tr>
      <th>POS</th>
      <th>CAR</th>
      <th style="width: 300px;">DRIVER</th>
      <th>TYRE</th>
      <th>LAPS</th>
      <th>GAP</th>
      <th>INT</th>
      <th>LAP TIME</th>
      <th style="width: 100px;">S1</th>
      <th style="width: 100px;">S2</th>
      <th style="width: 100px;">S3</th>
      <th>PIT</th>
    </tr>
  </thead>
  <transition-group name="slide" tag="tbody">
    <tr v-for="(pilot, index) in sortedPilots" :key="pilot.numero" class="table-row">
      <td>{{ pilot.position }}</td>
      <td>{{ pilot.numero }}</td>
      <td>{{ pilot.nom }}</td>
      <td :style="{ color: pilot.pneus.couleur }">
        <span class="tyre">{{ pilot.pneus.type }}</span> ({{ pilot.tours }})
      </td>
      <td>{{ pilot.laps }}</td>
      <td>{{ pilot.gap }}</td>
      <td>{{ pilot.interval }}</td>
      <td>{{ pilot.lapTime }}</td>
      <td :style="{ color: pilot.s1.color }">{{ pilot.s1.value }}</td>
      <td :style="{ color: pilot.s2.color }">{{ pilot.s2.value }}</td>
      <td :style="{ color: pilot.s3.color }">{{ pilot.s3.value }}</td>
      <td>{{ pilot.pit }}</td>
    </tr>
  </transition-group>
</table>

    </div>
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
  table {
  width: 100%; /* Adaptez la largeur selon vos besoins */
  background-color: #5a676e; /* Couleur de fond */
  border-collapse: collapse; /* Pour éviter les espaces entre les cellules */
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

tr:nth-child(even) {
  background-color: rgba(255, 255, 255, 0.1); /* Optionnel : couleur différente pour les lignes paires */
}

tr:hover {
  background-color: rgba(255, 255, 255, 0.2); /* Optionnel : effet au survol */
}


  </style>
  