#!/usr/bin/env node
/**
 * estadoKB.js — Guardián de estado del repositorio (rol "Guardián" del sistema de agentes).
 *
 * Uso:
 *   node backend/scripts/estadoKB.js            # imprime el bloque de estado (solo lectura)
 *   node backend/scripts/estadoKB.js --write    # refresca el bloque en docs/knowledge/ESTADO-ACTUAL.md
 *   node backend/scripts/estadoKB.js --check    # exit 1 si hay desalineación grave (job semanal de CI)
 *
 * Reglas que vigila:
 *   R1  el árbol de la copia inspeccionada está sucio
 *   R2  hay ramas con commits propios sin PR abierto y sin tag archive/*
 *   R3  hay ramas "muertas vivas" (0 commits fuera de main) que siguen existiendo
 *   R4  algún worktree apunta a una rama muerta
 *   R5  la rama inspeccionada está detrás de su remoto (desalineada)
 *
 * Sin dependencias externas. Nunca escribe salvo con --write, y nunca toca git.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO = 'Diegoromerov/belleza-app';
const BASE = 'main';
const KB_FILE = path.join('docs', 'knowledge', 'ESTADO-ACTUAL.md');
const INI = '<!-- estadoKB:inicio -->';
const FIN = '<!-- estadoKB:fin -->';

const args = process.argv.slice(2);
const DO_WRITE = args.includes('--write');
const DO_CHECK = args.includes('--check');

function git(...a) {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}
const root = git('rev-parse', '--show-toplevel');
if (!root) { console.error('estadoKB: no estoy dentro de un repositorio git'); process.exit(2); }
process.chdir(root);

// ---------- recolección ----------
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(desconocida)';
const head = git('rev-parse', '--short', 'HEAD') || '?';
const headDate = (git('log', '-1', '--format=%ci') || '?');
const dirtyRaw = git('status', '--porcelain', '-uall') || '';
const dirty = dirtyRaw ? dirtyRaw.split('\n').filter(Boolean) : [];

const locals = (git('for-each-ref', '--format=%(refname:short)|%(objectname:short)|%(committerdate:short)', 'refs/heads') || '')
  .split('\n').filter(Boolean).map(l => { const [n, s, d] = l.split('|'); return { name: n, sha: s, date: d }; });

const remoteHeads = (git('ls-remote', '--heads', 'origin') || '')
  .split('\n').filter(Boolean).map(l => l.split('\t')[1].replace('refs/heads/', ''));
const remoteOk = git('ls-remote', '--heads', 'origin') !== null;

const tags = (git('for-each-ref', '--format=%(refname:short)|%(objectname:short)|%(*objectname:short)', 'refs/tags') || '')
  .split('\n').filter(Boolean).map(l => l.split('|')).filter(r => r[0] && r[0].startsWith('archive/'))
  .map(([n, s, deref]) => ({ name: n, sha: (deref || s).slice(0, 8) }));
const remoteTagsCount = ((git('ls-remote', '--tags', 'origin') || '').match(/refs\/tags\/archive\//g) || []).length;

const worktrees = [];
{
  const raw = git('worktree', 'list', '--porcelain') || '';
  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9), branch: null, sha: null };
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line.startsWith('HEAD ') && cur) cur.sha = line.slice(5, 12);
    else if (line === '' && cur) { worktrees.push(cur); cur = null; }
  }
  if (cur) worktrees.push(cur);
}

function aheadOf(b) { const n = git('rev-list', '--count', `${BASE}..${b}`); return n === null ? null : parseInt(n, 10); }

const rows = locals.map(b => ({ ...b, ahead: aheadOf(b.name) }));

// PRs abiertos (API pública; si falla, NO VERIFICADO — nunca inventar [])
const fetchPRs = () => new Promise(resolve => {
  if (process.env.GUARDIAN_SKIP_NETWORK === '1' || process.env.GUARDIAN_SKIP_NETWORK === 'true') {
    return resolve(null);
  }
  const req = https.get({
    hostname: 'api.github.com', path: `/repos/${REPO}/pulls?state=open&per_page=100`,
    headers: { 'User-Agent': 'estadoKB/1.0', Accept: 'application/vnd.github+json' }, timeout: 15000
  }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { const j = JSON.parse(d); resolve(Array.isArray(j) ? j.map(p => ({ n: p.number, head: p.head.ref, base: p.base.ref })) : null); } catch { resolve(null); } });
  });
  req.on('timeout', () => { req.destroy(); resolve(null); });
  req.on('error', () => resolve(null));
});

(async () => {
  const prs = await fetchPRs();
  const prHeads = prs ? prs.map(p => p.head) : [];
  const tagByBranch = {};
  for (const t of tags) tagByBranch[t.name] = t.sha;

  // ---------- violaciones ----------
  const V = [];
  if (dirty.length) V.push({ r: 'R1', d: `${dirty.length} entradas sin commitear (${dirty.slice(0, 3).join(' · ')}${dirty.length > 3 ? ' …' : ''})` });
  const diasDesde = d => (Date.now() - new Date(d + 'T12:00:00Z').getTime()) / 86400000;
  for (const b of rows) {
    if (b.name === BASE) continue;
    if (b.ahead === null || b.ahead === 0) continue;
    if (prHeads.includes(b.name)) continue;                        // protegida: tiene PR abierto
    const cubierta = Object.values(tagByBranch).includes(b.sha);    // su tip está etiquetado archive/*
    const reciente = diasDesde(b.date) <= 14;                       // o tiene commits de las últimas 2 semanas
    if (!cubierta && !reciente) V.push({ r: 'R2', d: `«${b.name}» tiene ${b.ahead} commits propios, sin PR abierto, sin tag archive/* y sin commits en 14 días` });
  }
  for (const b of rows) {
    if (b.name === BASE || b.ahead === null) continue;
    if (b.ahead === 0) V.push({ r: 'R3', d: `«${b.name}» es muerta viva (0 commits fuera de ${BASE})` });
  }
  const muertas = new Set(rows.filter(b => b.ahead === 0).map(b => b.name));
  for (const w of worktrees) if (w.branch && muertas.has(w.branch)) V.push({ r: 'R4', d: `el worktree ${w.path} apunta a la rama muerta «${w.branch}»` });
  {
    const behind = git('rev-list', '--count', `${branch}..origin/${branch}`);
    if (behind !== null && parseInt(behind, 10) > 0) V.push({ r: 'R5', d: `la rama local «${branch}» está ${behind} commits detrás de origin/${branch}` });
  }

  // Regla R4 de frescura de partes (docs/agents/partes/): al menos 1 parte en los últimos 14 días
  {
    const partesDir = path.join('docs', 'agents', 'partes');
    let tieneParteReciente = false;
    if (fs.existsSync(partesDir)) {
      const archivos = fs.readdirSync(partesDir);
      for (const f of archivos) {
        if (f === 'PLANTILLA-PARTE.md' || !f.endsWith('.md')) continue;
        const match = f.match(/parte-(\d{4}-\d{2}-\d{2})\.md/);
        let fechaStr = null;
        if (match) {
          fechaStr = match[1];
        } else {
          try {
            const stat = fs.statSync(path.join(partesDir, f));
            fechaStr = stat.mtime.toISOString().slice(0, 10);
          } catch (e) {}
        }
        if (fechaStr && diasDesde(fechaStr) <= 14) {
          tieneParteReciente = true;
          break;
        }
      }
    }
    if (!tieneParteReciente) {
      V.push({ r: 'R4', d: '«docs/agents/partes/» no tiene ningún parte de estado en los últimos 14 días' });
    }
  }

  // ---------- salida ----------
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const L = [];
  L.push(INI);
  L.push(`> Bloque generado por \`backend/scripts/estadoKB.js\` el **${stamp}**. No se edita a mano.`);
  L.push('');
  L.push(`**Copia inspeccionada:** \`${root}\` · rama \`${branch}\` @ \`${head}\` (${headDate}) · árbol: ${dirty.length ? `**${dirty.length} entradas sin commitear**` : 'limpio'}`);
  L.push('');
  L.push(`**Ramas locales (${rows.length}):**`);
  L.push('');
  L.push('| Rama | SHA | Último commit | Commits fuera de ' + BASE + ' | PR abierto |');
  L.push('|---|---|---|---|---|');
  for (const b of rows.sort((a, c) => (c.ahead || 0) - (a.ahead || 0))) {
    L.push(`| \`${b.name}\` | \`${b.sha}\` | ${b.date} | ${b.ahead === null ? '?' : b.ahead} | ${prHeads.includes(b.name) ? 'sí' : '—'} |`);
  }
  L.push('');
  L.push(`**Ramas en el remoto:** ${remoteOk ? remoteHeads.length : 'NO VERIFICADO (sin red)'}${remoteOk ? ' → ' + remoteHeads.map(h => '`' + h + '`').join(' · ') : ''}`);
  L.push('');
  L.push(`**PRs abiertos:** ${prs === null ? '**NO VERIFICADO** (la consulta a la API falló; no se asume que sean 0)' : (prs.length ? prs.map(p => `#${p.n} \`${p.head}\` → \`${p.base}\``).join(' · ') : 'ninguno')}`);
  L.push('');
  L.push(`**Tags \`archive/*\`:** ${tags.length} locales · ${remoteOk ? remoteTagsCount + ' refs en el remoto' : 'NO VERIFICADO'}`);
  L.push('');
  L.push(`**Worktrees (${worktrees.length}):** ${worktrees.map(w => '`' + w.branch + '` @ ' + w.sha).join(' · ') || '—'}`);
  L.push('');
  L.push(`**Desalineaciones detectadas (${V.length}):**`);
  L.push('');
  if (!V.length) L.push('Ninguna. El repositorio está alineado y sin ramas zombis.');
  else { L.push('| Regla | Detalle |'); L.push('|---|---|'); for (const v of V) L.push(`| ${v.r} | ${v.d} |`); }
  L.push(FIN);
  const block = L.join('\n');

  if (DO_WRITE) {
    if (!fs.existsSync(KB_FILE)) { console.error(`estadoKB: no existe ${KB_FILE} — créalo con los marcadores antes de usar --write`); process.exit(2); }
    const src = fs.readFileSync(KB_FILE, 'utf8');
    const i = src.indexOf(INI), f = src.indexOf(FIN);
    if (i === -1 || f === -1 || f < i) { console.error(`estadoKB: faltan los marcadores ${INI} / ${FIN} en ${KB_FILE}`); process.exit(2); }
    fs.writeFileSync(KB_FILE, src.slice(0, i) + block + src.slice(f + FIN.length), 'utf8');
    console.log(`estadoKB: bloque refrescado en ${KB_FILE}`);
  } else {
    console.log(block);
  }

  console.log(`\nResumen: ramas=${rows.length} · muertas-vivas=${V.filter(v => v.r === 'R3').length} · sin-pr-ni-tag=${V.filter(v => v.r === 'R2').length} · worktrees=${worktrees.length} · desalineaciones=${V.length}`);
  if (DO_CHECK && V.some(v => ['R1', 'R2', 'R3', 'R4', 'R5'].includes(v.r))) {
    console.error(`estadoKB --check: ${V.length} desalineación(es) ⇒ fallo (exit 1)`);
    process.exit(1);
  }
  process.exit(0);
})();
