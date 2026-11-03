const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const binaryExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
    '.7z', '.exe', '.dll', '.so', '.dylib', '.pyc', '.pkl', '.ttf', '.woff', '.woff2'
  ];
  return binaryExtensions.includes(ext);
}

function checkConflictMarkers() {
  console.log('🔍 Escaneando archivos versionados en busca de marcadores de conflicto de merge...');
  
  let gitFiles = [];
  try {
    const rootDir = path.resolve(__dirname, '../..');
    const output = execSync('git ls-files', { cwd: rootDir, encoding: 'utf-8' });
    gitFiles = output.split('\n').filter(f => f.trim().length > 0);
  } catch (err) {
    console.error('❌ Error al ejecutar git ls-files:', err.message);
    process.exit(1);
  }

  let conflictsFound = 0;
  const rootDir = path.resolve(__dirname, '../..');

  const conflictRegex = /^<<<<<<<(\s+.*)?$|^=======$|^>>>>>>>(\s+.*)?$/;

  for (const relativePath of gitFiles) {
    const fullPath = path.join(rootDir, relativePath);

    if (!fs.existsSync(fullPath)) continue;
    if (isBinaryFile(fullPath)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (conflictRegex.test(trimmed)) {
          console.error(`❌ Marcador de conflicto encontrado en ${relativePath}:${index + 1} -> "${trimmed}"`);
          conflictsFound++;
        }
      });
    } catch (err) {
      // Ignorar errores de lectura si ocurre alguno (ej. codificación no-utf8)
    }
  }

  if (conflictsFound > 0) {
    console.error(`\n❌ SE ENCONTRARON ${conflictsFound} MARCADORES DE CONFLICTO. Abortando build.`);
    process.exit(1);
  } else {
    console.log('✅ Ningún marcador de conflicto encontrado en los archivos versionados.');
    process.exit(0);
  }
}

checkConflictMarkers();
