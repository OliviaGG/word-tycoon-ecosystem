const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Google Drive file ID for GoogleNews-vectors-negative300.bin.gz
const GDRIVE_FILE_ID = '0B7XkCwpI5KDYNlNUTTlSS21pQmM';
const DATA_DIR = path.join(__dirname, '..', 'data');
const W2V_DIR = path.join(DATA_DIR, 'word2vec');
const TARGET_FILE = path.join(W2V_DIR, 'GoogleNews-vectors-negative300.bin');
const GZ_PATH = path.join(W2V_DIR, 'GoogleNews-vectors-negative300.bin.gz');

if (fs.existsSync(TARGET_FILE)) {
  const stats = fs.statSync(TARGET_FILE);
  console.log(`GoogleNews-vectors-negative300.bin already exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  process.exit(0);
}

// Also support resuming from an already-downloaded .gz
if (fs.existsSync(GZ_PATH)) {
  const header = Buffer.alloc(2);
  const fd = fs.openSync(GZ_PATH, 'r');
  fs.readSync(fd, header, 0, 2, 0);
  fs.closeSync(fd);
  if (header[0] === 0x1f && header[1] === 0x8b) {
    console.log(`Found existing .gz file, skipping download...`);
    decompress().then(() => process.exit(0)).catch((err) => {
      console.error('Decompression error:', err.message);
      process.exit(1);
    });
    return;
  }
}

fs.mkdirSync(W2V_DIR, { recursive: true });

function httpGet(url, cookies) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    if (cookies) headers['Cookie'] = cookies;

    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers }, (res) => resolve(res)).on('error', reject);
  });
}

function extractCookies(res) {
  const setCookies = res.headers['set-cookie'];
  if (!setCookies) return '';
  return setCookies.map(c => c.split(';')[0]).join('; ');
}

async function downloadFromGDrive(dest) {
  const baseUrl = `https://drive.google.com/uc?export=download&id=${GDRIVE_FILE_ID}`;
  let cookies = '';
  let attempts = 0;
  let url = baseUrl;

  while (attempts < 5) {
    attempts++;
    console.log(`  Attempt ${attempts}: ${url.substring(0, 80)}...`);
    const res = await httpGet(url, cookies);

    // Collect cookies
    const newCookies = extractCookies(res);
    if (newCookies) {
      cookies = cookies ? cookies + '; ' + newCookies : newCookies;
    }

    // Follow redirects
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      url = res.headers.location;
      res.resume();
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode}`);
    }

    const contentType = res.headers['content-type'] || '';

    // If binary response, download it
    if (!contentType.includes('text/html')) {
      console.log('  Starting binary download...');
      const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      let lastPercent = -1;

      const file = fs.createWriteStream(dest);
      return new Promise((resolve, reject) => {
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
            if (downloaded % (10 * 1024 * 1024) < 65536) {
              process.stdout.write(`\r  Downloaded: ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('\n  Download complete.');
          resolve();
        });
        file.on('error', reject);
      });
    }

    // HTML response — extract confirm token
    let html = '';
    res.setEncoding('utf-8');
    await new Promise((resolve) => {
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', resolve);
    });

    // Try various confirm patterns
    const confirmMatch = html.match(/confirm=([a-zA-Z0-9_-]+)/);
    const uuidMatch = html.match(/uuid=([a-zA-Z0-9_-]+)/);

    if (confirmMatch) {
      url = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${GDRIVE_FILE_ID}`;
      console.log(`  Got confirm token: ${confirmMatch[1]}`);
    } else if (uuidMatch) {
      url = `https://drive.google.com/uc?export=download&id=${GDRIVE_FILE_ID}&uuid=${uuidMatch[1]}&confirm=t`;
      console.log(`  Got UUID token: ${uuidMatch[1]}`);
    } else {
      // Last resort: try with confirm=t and cookies
      url = `https://drive.google.com/uc?export=download&confirm=t&id=${GDRIVE_FILE_ID}`;
      console.log('  No token found, trying with confirm=t + cookies');
    }
  }

  throw new Error('Failed after maximum attempts. Please download manually.');
}

async function decompress() {
  console.log('\nDecompressing .gz file (this may take a minute)...');
  const input = fs.createReadStream(GZ_PATH);
  const output = fs.createWriteStream(TARGET_FILE);
  const gunzip = zlib.createGunzip();

  await new Promise((resolve, reject) => {
    input.pipe(gunzip).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
    gunzip.on('error', reject);
  });

  console.log('  Decompression complete.');
  fs.unlinkSync(GZ_PATH);
  console.log('  Cleaned up .gz file.');

  const stats = fs.statSync(TARGET_FILE);
  console.log(`\nDone! GoogleNews-vectors-negative300.bin is ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

async function main() {
  try {
    console.log('Downloading Word2Vec Google News vectors...');
    console.log('This is ~1.5 GB compressed and may take a while...\n');

    await downloadFromGDrive(GZ_PATH);

    // Verify it's actually a gzip file
    const header = Buffer.alloc(2);
    const fd = fs.openSync(GZ_PATH, 'r');
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);

    if (header[0] !== 0x1f || header[1] !== 0x8b) {
      console.error('\nThe downloaded file does not appear to be a valid gzip file.');
      console.error('Google Drive may have returned an error page instead.');
      showManualInstructions();
      if (fs.existsSync(GZ_PATH)) fs.unlinkSync(GZ_PATH);
      process.exit(1);
    }

    await decompress();
  } catch (err) {
    console.error('\nError:', err.message);
    showManualInstructions();
    if (fs.existsSync(GZ_PATH)) fs.unlinkSync(GZ_PATH);
    process.exit(1);
  }
}

function showManualInstructions() {
  console.error('\n========================================');
  console.error('MANUAL DOWNLOAD REQUIRED');
  console.error('========================================');
  console.error('Google Drive blocks automated downloads for large files.');
  console.error('Please download manually:');
  console.error('');
  console.error('1. Open in browser: https://drive.google.com/file/d/0B7XkCwpI5KDYNlNUTTlSS21pQmM');
  console.error('2. Click "Download anyway" when prompted');
  console.error(`3. Save the .gz file to: ${GZ_PATH}`);
  console.error('4. Run this script again to decompress it.');
  console.error('');
  console.error('Alternatively, use gdown (Python):');
  console.error('  pip install gdown');
  console.error(`  gdown "https://drive.google.com/uc?id=${GDRIVE_FILE_ID}" -O "${GZ_PATH}"`);
  console.error('  Then run this script again.');
  console.error('========================================');
}

main();
