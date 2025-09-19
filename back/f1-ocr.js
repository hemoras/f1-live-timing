// f1-ocr.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const csvWriter = require('csv-write-stream');

const configPath = './ocr.json';
const imagesDir = process.argv[2];

if (!imagesDir) {
    console.error('Usage: node f1-ocr.js <images-directory>');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath));
const templateConfig = config.find(t => t.videos.includes(path.basename(imagesDir)));
if (!templateConfig) {
    console.error('No template found for this video folder');
    process.exit(1);
}

const { table, columns } = templateConfig;
const columnKeys = ['numero', 'temps_tour', 'secteur1', 'secteur2', 'secteur3'];

const prevData = {};
let writer;

async function processImage(imagePath, index) {
    console.log(`Traitement de l'image ${index}`);
    const imgBuffer = fs.readFileSync(imagePath);
    const img = sharp(imgBuffer).extract(table);
    const { rows } = table;
    const metadata = await img.metadata();
    const tableHeight = table.height;
    const rowHeight = tableHeight / rows;


    // console.log('Dimensions de l\'image :', metadata.width, metadata.height);
    // console.log('Hauteur de la ligne :', rowHeight);

    for (let i = 0; i < rows; i++) {
        const rowTop = Math.round(i * rowHeight);
        const rowData = {};

        for (const key of columnKeys) {
            if (!columns[key]) continue;
            const { debut, fin } = columns[key];
            const width = fin - debut;
            // console.log(`crop: ${debut}, ${rowTop}, ${width}, ${Math.round(rowHeight)}`);
            const crop = await img.extract({ left: debut, top: rowTop, width, height: Math.round(rowHeight) }).toBuffer();
            const { data: { text } } = await Tesseract.recognize(crop, 'eng', { tessedit_char_whitelist: '0123456789:. ' });
            rowData[key] = text.trim().replace(/;/g, ',');
        }

        const numero = rowData['numero'];
        if (!numero) continue;

        if (!prevData[numero]) {
            prevData[numero] = {};
        }

        const hasChanged = ['temps_tour', 'secteur1', 'secteur2', 'secteur3'].some(key => rowData[key] !== prevData[numero][key]);

        if (hasChanged) {
            const csvRow = {
                idImage: index,
                timing: new Date(index * 15 * 1000).toISOString().substr(11, 8),
                numero: rowData['numero'],
                temps_tour: rowData['temps_tour'],
                secteur1: rowData['secteur1'].replace(/^(\d+)(\d)$/, "$1.$2"),
                secteur2: rowData['secteur2'].replace(/^(\d+)(\d)$/, "$1.$2"),
                secteur3: rowData['secteur3'].replace(/^(\d+)(\d)$/, "$1.$2")
            };

            writer.write(csvRow);

            for (const key of ['temps_tour', 'secteur1', 'secteur2', 'secteur3']) {
                prevData[numero][key] = rowData[key];
            }
        }
    }
}

(async () => {
    const images = fs.readdirSync(imagesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort((a, b) => parseInt(a) - parseInt(b));

    if (images.length === 0) {
        console.error('No images found');
        process.exit(1);
    }

    const writerOptions = { separator: ';', headers: ['idImage', 'timing', 'numero', 'temps_tour', 'secteur1', 'secteur2', 'secteur3'] };
    writer = csvWriter(writerOptions);
    writer.pipe(fs.createWriteStream(path.join(imagesDir, 'output.csv')));

    for (const img of images) {
        const index = parseInt(path.basename(img, '.jpg'));
        await processImage(path.join(imagesDir, img), index);
    }

    writer.end();
    console.log('Processing complete');
})();