// utils.js
const fs = require('fs');
const unzipper = require('unzipper'); // Assurez-vous d'avoir installé ce package: npm install unzipper

async function checkAndExtractDirectory(directoryPath) {
  try {
    // Vérifie si le répertoire existe
    await fs.promises.access(directoryPath);
  } catch (err) {
    console.log(`Le répertoire ${directoryPath} n'existe pas.`);

    // Si le répertoire n'existe pas, on vérifie si le fichier zip existe
    const zipFilePath = `${directoryPath}.zip`;
    try {
      await fs.promises.access(zipFilePath);

      // Si le fichier zip existe, on l'extrait dans le répertoire
      console.log(`Extraction de ${zipFilePath} dans ${directoryPath}...`);
      await fs.createReadStream(zipFilePath)
        .pipe(unzipper.Extract({ path: directoryPath }))
        .promise();

      console.log(`Extraction terminée, réessayons de lire le répertoire ${directoryPath}...`);
      
    } catch (zipErr) {
      // Si le zip n'existe pas non plus, on affiche une erreur et on renvoie null
      console.error(`Aucune donnée trouvée pour ${directoryPath}`);
      return null;
    }
  }

  // Lecture du répertoire après extraction
  try {
    const files = await fs.promises.readdir(directoryPath);
    return files;
  } catch (readErr) {
    console.error(`Erreur lors de la lecture du répertoire ${directoryPath}:`, readErr.message);
    return null;
  }
}

function formatTime(seconds) {
  // Extraire les minutes
  const minutes = Math.floor(seconds / 60);

  // Extraire les secondes
  const sec = Math.floor(seconds % 60);

  // Extraire les millisecondes et les arrondir à trois chiffres
  const milliseconds = Math.floor((seconds % 1) * 1000);

  // Formater les valeurs pour toujours avoir 2 chiffres pour les secondes et 3 pour les millisecondes
  const formattedSeconds = String(sec).padStart(2, '0');
  const formattedMilliseconds = String(milliseconds).padStart(3, '0');

  // Retourner le temps au format "m:ss.000"
  return `${minutes}:${formattedSeconds}.${formattedMilliseconds}`;
}

// Exporte la fonction pour l'utiliser dans d'autres scripts
module.exports = { checkAndExtractDirectory, formatTime };

