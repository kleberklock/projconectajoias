const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function processImage(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(new PNG({ filterType: 4 }))
      .on('parsed', function () {
        const width = this.width;
        const height = this.height;
        const data = this.data;

        const visited = new Uint8Array(width * height);
        const queueX = new Int32Array(width * height * 2);
        const queueY = new Int32Array(width * height * 2);
        let head = 0;
        let tail = 0;

        function isBgColor(r, g, b) {
          const minVal = Math.min(r, g, b);
          const maxVal = Math.max(r, g, b);
          const diff = maxVal - minVal;
          if (r > 200 && g > 200 && b > 200 && diff < 35) {
            return true;
          }
          return false;
        }

        // Adiciona as bordas
        for (let x = 0; x < width; x++) {
          queueX[tail] = x; queueY[tail] = 0; tail++;
          queueX[tail] = x; queueY[tail] = height - 1; tail++;
        }
        for (let y = 0; y < height; y++) {
          queueX[tail] = 0; queueY[tail] = y; tail++;
          queueX[tail] = width - 1; queueY[tail] = y; tail++;
        }

        while (head < tail) {
          const cx = queueX[head];
          const cy = queueY[head];
          head++;

          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

          const idx = cy * width + cx;
          if (visited[idx]) continue;
          visited[idx] = 1;

          const pixelIdx = idx * 4;
          const r = data[pixelIdx];
          const g = data[pixelIdx + 1];
          const b = data[pixelIdx + 2];
          const a = data[pixelIdx + 3];

          if (a > 0 && isBgColor(r, g, b)) {
            const avg = (r + g + b) / 3;
            if (avg > 240) {
              data[pixelIdx + 3] = 0;
            } else {
              const alphaFactor = (240 - avg) / 40;
              data[pixelIdx + 3] = Math.max(0, Math.min(255, Math.floor(alphaFactor * 255)));
            }

            // Vizinhos 4-direcionais
            if (cx + 1 < width)  { queueX[tail] = cx + 1; queueY[tail] = cy; tail++; }
            if (cx - 1 >= 0)     { queueX[tail] = cx - 1; queueY[tail] = cy; tail++; }
            if (cy + 1 < height) { queueX[tail] = cx; queueY[tail] = cy + 1; tail++; }
            if (cy - 1 >= 0)     { queueX[tail] = cx; queueY[tail] = cy - 1; tail++; }
          }
        }

        this.pack()
          .pipe(fs.createWriteStream(outputPath))
          .on('finish', () => {
            console.log(`✅ Imagem salva com fundo transparente: ${outputPath}`);
            resolve();
          })
          .on('error', reject);
      })
      .on('error', reject);
  });
}

async function run() {
  const logoPath = path.resolve(__dirname, '../../frontend/assets/logo.png');
  const faviconPath = path.resolve(__dirname, '../../frontend/assets/favicon.png');

  console.log('Processando remoção de fundo branco rápido...');
  await processImage(logoPath, logoPath);
  await processImage(faviconPath, faviconPath);
  console.log('Concluído com sucesso!');
}

run().catch(console.error);
