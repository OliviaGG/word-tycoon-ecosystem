const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GLOVE_URL = 'https://nlp.stanford.edu/data/glove.6B.zip';
const DATA_DIR = path.join(__dirname, '..', 'data');
const GLOVE_DIR = path.join(DATA_DIR, 'glove');
const TARGET_50D = path.join(GLOVE_DIR, 'glove.6B.50d.txt');
const TARGET_300D = path.join(GLOVE_DIR, 'glove.6B.300d.txt');
const ZIP_PATH = path.join(DATA_DIR, 'glove.6B.zip');

const have50d = fs.existsSync(TARGET_50D);
const have300d = fs.existsSync(TARGET_300D);

if (have50d && have300d) {
  console.log(`glove.6B.50d.txt already exists (${(fs.statSync(TARGET_50D).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`glove.6B.300d.txt already exists (${(fs.statSync(TARGET_300D).size / 1024 / 1024).toFixed(1)} MB)`);
  process.exit(0);
}

fs.mkdirSync(GLOVE_DIR, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading GloVe vectors from:\n  ${url}`);
    console.log(`This is ~862 MB and may take several minutes...\n`);

    const file = fs.createWriteStream(dest);

    function followRedirect(url) {
      const mod = url.startsWith('https') ? https : require('http');
      mod.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          followRedirect(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastPercent = -1;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.floor((downloaded / totalBytes) * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              const mb = (downloaded / 1024 / 1024).toFixed(1);
              const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
              process.stdout.write(`\r  Progress: ${mb} MB / ${totalMb} MB (${percent}%)`);
            }
          } else {
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r  Downloaded: ${mb} MB`);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('\n  Download complete.');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    }

    followRedirect(url);
  });
}

async function main() {
  try {
    await download(GLOVE_URL, ZIP_PATH);

    console.log('\nExtracting GloVe files...');
    const extractDir = path.join(DATA_DIR, 'glove_extract');
    fs.mkdirSync(extractDir, { recursive: true });

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      execSync(`powershell -command "Expand-Archive -Path '${ZIP_PATH}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit', timeout: 600000 });
    } else {
      execSync(`unzip -o '${ZIP_PATH}' -d '${extractDir}'`, { stdio: 'inherit', timeout: 600000 });
    }

    // Extract 50d (legacy)
    const extracted50d = path.join(extractDir, 'glove.6B.50d.txt');
    if (fs.existsSync(extracted50d) && !have50d) {
      fs.renameSync(extracted50d, TARGET_50D);
      console.log(`  Moved glove.6B.50d.txt to ${TARGET_50D}`);
    }

    // Extract 300d
    const extracted300d = path.join(extractDir, 'glove.6B.300d.txt');
    if (fs.existsSync(extracted300d) && !have300d) {
      fs.renameSync(extracted300d, TARGET_300D);
      console.log(`  Moved glove.6B.300d.txt to ${TARGET_300D}`);
    }

    // Clean up
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(ZIP_PATH);
    console.log('  Cleaned up temporary files.');

    if (fs.existsSync(TARGET_50D)) {
      console.log(`\nglove.6B.50d.txt is ${(fs.statSync(TARGET_50D).size / 1024 / 1024).toFixed(1)} MB`);
    }
    if (fs.existsSync(TARGET_300D)) {
      console.log(`glove.6B.300d.txt is ${(fs.statSync(TARGET_300D).size / 1024 / 1024).toFixed(1)} MB`);
    }
    console.log('\nDone!');
  } catch (err) {
    console.error('\nError:', err.message);
    // Clean up partial files
    if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);
    process.exit(1);
  }
}

main();
