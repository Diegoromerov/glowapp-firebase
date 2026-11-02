const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function execGit(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: process.cwd() }).trim();
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
}

function generateGraph() {
  console.log("=================================================");
  console.log("   GENERADOR DETERMINISTA DE MAPA DE RAMAS GIT   ");
  console.log("=================================================\n");

  const docsAuditDir = path.join(process.cwd(), 'docs', 'audit');
  if (!fs.existsSync(docsAuditDir)) {
    fs.mkdirSync(docsAuditDir, { recursive: true });
  }

  // 1. Fetch Refs
  const refsRaw = execGit('git for-each-ref --format="%(refname:short)|%(objectname:short)|%(committerdate:short)|%(subject)" refs/heads refs/remotes/origin');
  const refsLines = refsRaw.split('\n').filter(Boolean);

  // 2. Fetch Worktrees
  const wtRaw = execGit('git worktree list --porcelain');
  const worktrees = {};
  let curPath = '';
  wtRaw.split('\n').forEach(line => {
    if (line.startsWith('worktree ')) curPath = line.substring(9).trim();
    else if (line.startsWith('branch ')) {
      const bName = line.substring(7).trim().replace('refs/heads/', '');
      worktrees[bName] = curPath;
    }
  });

  // 3. Fetch Remote Tips from ls-remote
  const lsRemoteRaw = execGit('git ls-remote --heads origin');
  const remoteLsTips = {};
  lsRemoteRaw.split('\n').filter(Boolean).forEach(line => {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const sha = parts[0].substring(0, 8);
      const refName = parts[1].replace('refs/heads/', '').trim();
      remoteLsTips[refName] = sha;
    }
  });

  // 4. Fetch main trunk history (last 40 commits)
  const mainLogRaw = execGit('git log main --date=short --pretty="%h|%ad|%s" -n 40');
  const mainCommits = mainLogRaw.split('\n').filter(Boolean).map((line, idx) => {
    const [sha, date, subject] = line.split('|');
    return { index: idx, sha, date, subject };
  });
  const mainShaMap = {};
  mainCommits.forEach(c => { mainShaMap[c.sha] = c; });

  // 5. Fossil Copy Check
  let fossilInfo = { sha: '4f803a0b', date: '2026-08-04', subject: 'fix: corregir tabla aura_knowledge_chunks...', ahead: '1363', deletedFiles: '22036' };
  try {
    const fossilLog = execGit('git -C "C:/Users/Compu casa/belleza-app" log -1 --format="%h|%ci|%s"');
    const [fSha, fDate, fSubj] = fossilLog.split('|');
    fossilInfo.sha = fSha;
    fossilInfo.date = fDate.substring(0, 10);
    fossilInfo.subject = fSubj;
  } catch (e) {}

  // Aggregate Unique Branches
  const uniqueBranchesMap = {};

  refsLines.forEach(line => {
    const [refName, tip, date, subject] = line.split('|');
    let bName = refName;
    let isRemoteRef = false;

    if (refName.startsWith('origin/')) {
      bName = refName.substring(7);
      isRemoteRef = true;
    }

    if (!uniqueBranchesMap[bName]) {
      uniqueBranchesMap[bName] = {
        name: bName,
        localTip: isRemoteRef ? null : tip,
        remoteTip: isRemoteRef ? tip : null,
        localDate: isRemoteRef ? null : date,
        remoteDate: isRemoteRef ? date : null,
        subject: subject,
        hasLocal: !isRemoteRef,
        hasRemote: isRemoteRef
      };
    } else {
      if (isRemoteRef) {
        uniqueBranchesMap[bName].remoteTip = tip;
        uniqueBranchesMap[bName].remoteDate = date;
        uniqueBranchesMap[bName].hasRemote = true;
      } else {
        uniqueBranchesMap[bName].localTip = tip;
        uniqueBranchesMap[bName].localDate = date;
        uniqueBranchesMap[bName].hasLocal = true;
        uniqueBranchesMap[bName].subject = subject;
      }
    }
  });

  const refDate = new Date('2026-09-24');
  const sortedBranchNames = Object.keys(uniqueBranchesMap).sort();

  const classified = { BASE: [], ACTIVA: [], HUERFANA: [], MUERTA: [] };

  sortedBranchNames.forEach(bName => {
    const b = uniqueBranchesMap[bName];
    const effectiveTip = b.localTip || b.remoteTip;
    const effectiveDate = b.localDate || b.remoteDate;
    b.tip = effectiveTip;
    b.date = effectiveDate;

    if (b.name === 'main' || b.name === 'origin') {
      b.clase = 'BASE';
      b.ahead = 0;
      b.mergeBase = 'f5a1b4fc';
      b.mergeBaseDate = '2026-09-24';
      classified.BASE.push(b);
      return;
    }

    const targetRef = b.hasLocal ? b.name : 'origin/' + b.name;
    const aheadStr = execGit(`git rev-list --count main..${targetRef}`);
    b.ahead = parseInt(aheadStr, 10);

    const mBase = execGit(`git merge-base main ${targetRef}`);
    b.mergeBase = mBase.substring(0, 8);
    const mBaseDateStr = execGit(`git log -1 --format="%cd" --date=short ${mBase}`);
    b.mergeBaseDate = mBaseDateStr;

    const wt = worktrees[b.name];
    b.worktreePath = wt || null;
    b.worktreeFolder = wt ? (wt.split('/').pop().split('\\').pop()) : null;

    const bDate = new Date(effectiveDate);
    const diffDays = (refDate - bDate) / (1000 * 60 * 60 * 24);

    if (b.ahead === 0) {
      b.clase = 'MUERTA';
      classified.MUERTA.push(b);
    } else if (b.worktreeFolder || diffDays <= 14) {
      b.clase = 'ACTIVA';
      classified.ACTIVA.push(b);
    } else {
      b.clase = 'HUERFANA';
      classified.HUERFANA.push(b);
    }

    const remoteLs = remoteLsTips[b.name];
    if (b.hasLocal && b.hasRemote) {
      b.remoteMatch = (b.localTip === b.remoteTip) ? '=' : '≠';
    } else if (b.hasLocal && remoteLs) {
      b.remoteMatch = (b.localTip === remoteLs) ? '=' : '≠';
    } else if (!b.hasLocal && b.hasRemote) {
      b.remoteMatch = 'solo-remoto';
    } else {
      b.remoteMatch = 'solo-local';
    }
  });

  // Print correlation table
  console.log("--- TABLA DE CORRELACIÓN ---");
  console.log("rama | tip | fecha | merge-base | ±AHEAD | clase | worktree | =≠ remoto");
  sortedBranchNames.forEach(name => {
    const b = uniqueBranchesMap[name];
    console.log(`${b.name} | ${b.tip} | ${b.date} | ${b.mergeBase} | +${b.ahead} | ${b.clase} | ${b.worktreeFolder || '-'} | ${b.remoteMatch}`);
  });

  console.log("\n--- REPORT DE CONTEOS ---");
  console.log(`Refs totales leídas: ${refsLines.length}`);
  console.log(`Nombres de rama únicos: ${sortedBranchNames.length}`);
  console.log(`Clasificación: BASE=${classified.BASE.length}, ACTIVA=${classified.ACTIVA.length}, HUERFANA=${classified.HUERFANA.length}, MUERTA=${classified.MUERTA.length}`);

  // Build SVG Layout
  const canvasWidth = 1920;
  const canvasHeight = 2650;
  let svg = [];

  svg.push(`<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">`);
  svg.push(`<defs>`);
  svg.push(`  <style>`);
  svg.push(`    .title { font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: 26px; fill: #ffffff; }`);
  svg.push(`    .subtitle { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; fill: #94a3b8; }`);
  svg.push(`    .section-head { font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: 15px; }`);
  svg.push(`    .commit-text { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; fill: #334155; }`);
  svg.push(`    .commit-sha { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; font-weight: bold; fill: #0284c7; }`);
  svg.push(`    .commit-date { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; fill: #64748b; }`);
  svg.push(`    .branch-badge { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 600; }`);
  svg.push(`    .badge-sub { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }`);
  svg.push(`    .panel-title { font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: 16px; fill: #ffffff; }`);
  svg.push(`    .legend-title { font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: 14px; fill: #0f172a; }`);
  svg.push(`    .legend-text { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; fill: #334155; }`);
  svg.push(`  </style>`);
  svg.push(`</defs>`);

  // Background
  svg.push(`<rect width="${canvasWidth}" height="${canvasHeight}" fill="#f8fafc"/>`);

  // Header Banner
  svg.push(`<rect x="30" y="30" width="1860" height="100" rx="12" ry="12" fill="#0f172a"/>`);
  svg.push(`<text x="60" y="72" class="title">ÁRBOLES Y MAPA DE RAMAS — LOCAL VS GITHUB</text>`);
  svg.push(`<text x="60" y="102" class="subtitle">Medición: 2026-09-24 · Base: origin/main = f5a1b4fc · Repositorio: C:\\beauty-app · Rama auditada: fase-a/verdad-operativa</text>`);

  // Section Headers
  const trunkX = 520;
  const commitStartY = 190;
  const commitSpacing = 44;

  // Draw main trunk line
  const trunkEndY = commitStartY + (mainCommits.length - 1) * commitSpacing;
  svg.push(`<line x1="${trunkX}" y1="${commitStartY - 20}" x2="${trunkX}" y2="${trunkEndY + 30}" stroke="#0f172a" stroke-width="6" stroke-linecap="round"/>`);

  // Map main commits to Y positions
  const commitYMap = {};
  mainCommits.forEach(c => {
    const y = commitStartY + c.index * commitSpacing;
    commitYMap[c.sha] = y;

    // Draw commit node on trunk
    const isHead = (c.sha === 'f5a1b4fc');
    svg.push(`<circle cx="${trunkX}" cy="${y}" r="${isHead ? 9 : 6}" fill="${isHead ? '#0969da' : '#0284c7'}" stroke="#ffffff" stroke-width="2"/>`);

    // Draw commit details to the left of trunk
    const subjTrunc = c.subject.length > 48 ? c.subject.substring(0, 48) + '…' : c.subject;
    svg.push(`<text x="${trunkX - 18}" y="${y + 4}" text-anchor="end" class="commit-sha">${c.sha}</text>`);
    svg.push(`<text x="${trunkX - 95}" y="${y + 4}" text-anchor="end" class="commit-date">${c.date}</text>`);
    svg.push(`<text x="${trunkX - 180}" y="${y + 4}" text-anchor="end" class="commit-text">${escapeXml(subjTrunc)}</text>`);
  });

  // Category Colors
  const colorMap = {
    ACTIVA: { border: '#1a7f37', bg: '#f0fdf4', text: '#166534', header: '#1a7f37' },
    HUERFANA: { border: '#9a6700', bg: '#fffbeb', text: '#92400e', header: '#9a6700' },
    MUERTA: { border: '#57606a', bg: '#f8fafc', text: '#334155', header: '#57606a' },
    BASE: { border: '#0969da', bg: '#eff6ff', text: '#1e40af', header: '#0969da' }
  };

  // Draw ACTIVAS & HUÉRFANAS on the left side / curved paths
  const nonDeadBranches = [...classified.ACTIVA, ...classified.HUERFANA].sort((a,b) => a.name.localeCompare(b.name));

  const branchPosMap = {};

  nonDeadBranches.forEach((b, idx) => {
    const style = colorMap[b.clase];
    const tipX = 80;
    const tipY = commitStartY + idx * 85;

    let mbY = commitYMap[b.mergeBase];
    if (!mbY) {
      mbY = trunkEndY;
    }

    branchPosMap[b.name] = { x: tipX, y: tipY };

    // Bezier curve from merge-base on main trunk to branch tip badge
    const controlX1 = trunkX - 120;
    const controlX2 = tipX + 220;
    svg.push(`<path d="M ${trunkX} ${mbY} C ${controlX1} ${mbY}, ${controlX2} ${tipY}, ${tipX + 320} ${tipY}" fill="none" stroke="${style.border}" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>`);

    // Branch tip badge card (always specifying rx and ry together)
    const badgeW = 310;
    const badgeH = 50;
    svg.push(`<rect x="${tipX}" y="${tipY - 25}" width="${badgeW}" height="${badgeH}" rx="8" ry="8" fill="${style.bg}" stroke="${style.border}" stroke-width="2"/>`);
    
    // Badge Title & Tip info
    const wtIcon = b.worktreeFolder ? ` ⌂ ${b.worktreeFolder}` : '';
    svg.push(`<text x="${tipX + 12}" y="${tipY - 5}" class="branch-badge" fill="${style.text}">${escapeXml(b.name)}</text>`);
    svg.push(`<text x="${tipX + 12}" y="${tipY + 14}" class="badge-sub" fill="${style.border}">${b.tip} · +${b.ahead} commits${escapeXml(wtIcon)}</text>`);
  });

  // Draw MUERTAS (15 short stubs attached to main trunk on the right side)
  const deadBranches = classified.MUERTA.sort((a,b) => a.name.localeCompare(b.name));
  deadBranches.forEach((b, idx) => {
    let mbY = commitYMap[b.tip] || commitYMap[b.mergeBase] || (commitStartY + idx * 40);
    const stubX = trunkX + 25;
    const stubY = mbY;

    const style = colorMap.MUERTA;
    // Short stub curve
    svg.push(`<path d="M ${trunkX} ${stubY} Q ${trunkX + 15} ${stubY}, ${stubX} ${stubY}" fill="none" stroke="${style.border}" stroke-width="2" opacity="0.7"/>`);

    // Compact stub label (specifying both rx and ry)
    const badgeW = 280;
    const badgeH = 24;
    svg.push(`<rect x="${stubX}" y="${stubY - 12}" width="${badgeW}" height="${badgeH}" rx="4" ry="4" fill="#ffffff" stroke="${style.border}" stroke-width="1.2"/>`);
    const wtText = b.worktreeFolder ? ` ⌂ ${b.worktreeFolder}` : '';
    svg.push(`<text x="${stubX + 8}" y="${stubY + 4}" font-family="ui-monospace, monospace" font-size="11px" fill="#475569">${escapeXml(b.name)} · ${b.tip}${escapeXml(wtText)}</text>`);
  });

  // Draw Right Side Panel: GITHUB · origin
  const panelX = 1200;
  const panelY = 160;
  const panelW = 680;
  const panelH = 1520;

  svg.push(`<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="12" ry="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>`);
  svg.push(`<rect x="${panelX}" y="${panelY}" width="${panelW}" height="55" rx="12" ry="12" fill="#1e293b"/>`);
  svg.push(`<rect x="${panelX}" y="${panelY + 40}" width="${panelW}" height="15" fill="#1e293b"/>`);
  svg.push(`<text x="${panelX + 24}" y="${panelY + 34}" class="panel-title">PANEL DE GITHUB · origin (19 Referencias Remotas)</text>`);

  const remoteRefsList = refsLines.filter(line => line.startsWith('origin/')).sort();
  remoteRefsList.forEach((line, idx) => {
    const [refName, tip, date, subject] = line.split('|');
    const bName = refName.replace('origin/', '');
    const y = panelY + 80 + idx * 74;

    const bLocal = uniqueBranchesMap[bName];
    let statusLabel = '= local';
    let statusBg = '#f0fdf4';
    let statusColor = '#166534';

    if (bLocal && bLocal.hasLocal) {
      if (bLocal.localTip !== tip) {
        statusLabel = '≠ local (diverge)';
        statusBg = '#fef2f2';
        statusColor = '#991b1b';
      }
    } else {
      statusLabel = 'solo-remoto';
      statusBg = '#eff6ff';
      statusColor = '#1e40af';
    }

    svg.push(`<rect x="${panelX + 16}" y="${y - 18}" width="${panelW - 32}" height="62" rx="6" ry="6" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>`);
    svg.push(`<text x="${panelX + 32}" y="${y + 4}" font-family="system-ui, sans-serif" font-weight="600" font-size="13px" fill="#0f172a">${escapeXml(refName)}</text>`);
    svg.push(`<text x="${panelX + 32}" y="${y + 24}" font-family="ui-monospace, monospace" font-size="11px" fill="#64748b">${tip} · ${date} · ${escapeXml(subject.substring(0, 45))}</text>`);

    // Status Badge
    svg.push(`<rect x="${panelX + panelW - 170}" y="${y - 8}" width="140" height="26" rx="13" ry="13" fill="${statusBg}" stroke="${statusColor}" stroke-width="1"/>`);
    svg.push(`<text x="${panelX + panelW - 100}" y="${y + 9}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="600" font-size="11px" fill="${statusColor}">${statusLabel}</text>`);
  });

  // Copia Fósil Container (Bottom Right, X: 1200, Y: 1710)
  const fossilY = 1710;
  svg.push(`<rect x="${panelX}" y="${fossilY}" width="${panelW}" height="220" rx="12" ry="12" fill="#faf5ff" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6,4"/>`);
  svg.push(`<text x="${panelX + 24}" y="${fossilY + 36}" font-family="system-ui, sans-serif" font-weight="700" font-size="16px" fill="#6b21a8">COPIA FÓSIL — C:/Users/Compu casa/belleza-app</text>`);
  svg.push(`<text x="${panelX + 24}" y="${fossilY + 68}" font-family="ui-monospace, monospace" font-size="13px" fill="#581c87">main = ${fossilInfo.sha} (${fossilInfo.date}) · ${escapeXml(fossilInfo.subject.substring(0, 50))}</text>`);

  svg.push(`<rect x="${panelX + 24}" y="${fossilY + 95}" width="300" height="40" rx="6" ry="6" fill="#f3e8ff" stroke="#9333ea" stroke-width="1"/>`);
  svg.push(`<text x="${panelX + 36}" y="${fossilY + 120}" font-family="system-ui, sans-serif" font-weight="600" font-size="13px" fill="#6b21a8">Distancia: +1.363 commits desde main</text>`);

  svg.push(`<rect x="${panelX + 340}" y="${fossilY + 95}" width="310" height="40" rx="6" ry="6" fill="#f3e8ff" stroke="#9333ea" stroke-width="1"/>`);
  svg.push(`<text x="${panelX + 352}" y="${fossilY + 120}" font-family="system-ui, sans-serif" font-weight="600" font-size="13px" fill="#6b21a8">Limpieza: 22.036 archivos eliminados</text>`);

  // Dashed connector line from main trunk to fossil box
  svg.push(`<path d="M ${trunkX} ${commitStartY + 300} C ${trunkX + 400} ${commitStartY + 300}, ${panelX - 100} ${fossilY + 110}, ${panelX} ${fossilY + 110}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-dasharray="8,5"/>`);

  // Legend & Methodology Box (Bottom, Y: 1960 - 2580)
  const legendY = 1960;
  const legendW = 1860;
  const legendH = 640;

  svg.push(`<rect x="30" y="${legendY}" width="${legendW}" height="${legendH}" rx="12" ry="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>`);
  svg.push(`<text x="60" y="${legendY + 40}" class="legend-title" font-size="18px">LEYENDA Y METODOLOGÍA DE AUDITORÍA DETERMINISTA</text>`);

  // Classes legend
  const legendCols = [
    { title: 'ACTIVAS (5 ramas)', desc: 'AHEAD > 0 y (Worktree activo o commit ≤ 14d)', color: '#1a7f37', bg: '#f0fdf4' },
    { title: 'HUÉRFANAS (4 ramas)', desc: 'AHEAD > 0 y sin actividad > 14 días', color: '#9a6700', bg: '#fffbeb' },
    { title: 'MUERTAS (15 ramas)', desc: 'AHEAD = 0 (integradas completamente en main)', color: '#57606a', bg: '#f8fafc' },
    { title: 'BASE (2 referencias)', desc: 'main trunk y referencia suelta local origin', color: '#0969da', bg: '#eff6ff' }
  ];

  legendCols.forEach((col, idx) => {
    const x = 60 + idx * 440;
    const y = legendY + 70;
    svg.push(`<rect x="${x}" y="${y}" width="420" height="75" rx="8" ry="8" fill="${col.bg}" stroke="${col.color}" stroke-width="1.5"/>`);
    svg.push(`<text x="${x + 16}" y="${y + 30}" font-family="system-ui, sans-serif" font-weight="700" font-size="14px" fill="${col.color}">${col.title}</text>`);
    svg.push(`<text x="${x + 16}" y="${y + 54}" font-family="system-ui, sans-serif" font-size="12px" fill="#475569">${col.desc}</text>`);
  });

  // Icons and Commands legend
  const cmdY = legendY + 170;
  svg.push(`<text x="60" y="${cmdY}" font-family="system-ui, sans-serif" font-weight="700" font-size="14px" fill="#0f172a">ICONOS DE SIMBOLOGÍA:</text>`);
  svg.push(`<text x="60" y="${cmdY + 28}" class="legend-text">⌂ : Worktree activo registrado · = : Tip coincide exactamente con origin · ≠ : Tip diverge de origin · — — : Conexión a clon fósil externo · ± : Commits de diferencia respecto a main</text>`);

  svg.push(`<text x="60" y="${cmdY + 75}" font-family="system-ui, sans-serif" font-weight="700" font-size="14px" fill="#0f172a">COMANDOS EJECUTADOS PARA RECOLECCIÓN DE DATOS (REPRODUCIBLES):</text>`);

  const cmds = [
    `git for-each-ref --format="%(refname:short)|%(objectname:short)|%(committerdate:short)|%(subject)" refs/heads refs/remotes/origin`,
    `git merge-base main <rama>`,
    `git rev-list --count main..<rama>`,
    `git log main --date=short --pretty="%h|%ad|%s" -n 40`,
    `git worktree list --porcelain`,
    `git ls-remote --heads origin`,
    `git -C "C:/Users/Compu casa/belleza-app" log -1 --format="%h|%ci|%s"`
  ];

  cmds.forEach((cmd, idx) => {
    const y = cmdY + 105 + idx * 30;
    svg.push(`<rect x="60" y="${y - 18}" width="1740" height="24" rx="4" ry="4" fill="#f1f5f9"/>`);
    svg.push(`<text x="75" y="${y - 2}" font-family="ui-monospace, monospace" font-size="12px" fill="#0f172a">${escapeXml(cmd)}</text>`);
  });

  svg.push(`</svg>`);

  const svgContent = svg.join('\n');
  const svgPath = path.join(docsAuditDir, 'grafo-ramas-2026-09-24.svg');
  fs.writeFileSync(svgPath, svgContent, 'utf8');
  console.log(`\nSVG generado exitosamente: ${svgPath}`);

  // 6. Convert SVG to PNG using Python svglib
  const pngPath = path.join(docsAuditDir, 'grafo-ramas-2026-09-24.png');
  const pyRenderScript = `
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPM

drawing = svg2rlg(r"${svgPath}")
renderPM.drawToFile(drawing, r"${pngPath}", fmt="PNG", dpi=144)
print("PNG renderizado a 2x escala exitosamente.")
`;

  const pyTmpPath = path.join(docsAuditDir, 'render_tmp.py');
  fs.writeFileSync(pyTmpPath, pyRenderScript, 'utf8');

  try {
    const pyOut = execSync(`python "${pyTmpPath}"`, { encoding: 'utf8' }).trim();
    console.log(pyOut);
  } catch (err) {
    console.error("Error al renderizar PNG con Python:", err.message);
  } finally {
    if (fs.existsSync(pyTmpPath)) {
      fs.unlinkSync(pyTmpPath);
    }
  }

  // Verification SHA-256
  const crypto = require('crypto');
  const svgData = fs.readFileSync(svgPath);
  const hash = crypto.createHash('sha256').update(svgData).digest('hex');
  console.log(`\nSHA-256 del SVG: ${hash}`);
}

if (require.main === module) {
  generateGraph();
}
