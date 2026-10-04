// Pruebas de paridad del generador de propuestas (etapa 1). Compara los
// módulos TS contra los scripts ORIGINALES de la skill (que se conservan en
// src/serverUtils/propuestas/skill/scripts/ justo para esto):
//   · revisarContenido (TS) vs revisar.py — mismo conjunto y orden de problemas
//     sobre el ejemplo y sobre contenidos con errores (spec §11).
//   · construirPropuesta (TS) vs construir.js — mismas láminas XML y mismos
//     medios dentro del .pptx.
// El repo no tiene corredor de pruebas; esto se corre a mano:
//   cd server && npx tsx scripts/test-propuestas.ts
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { revisarContenido } from '../../src/serverUtils/propuestas/revisar';
import { construirPropuesta } from '../../src/serverUtils/propuestas/construir';

const SKILL = path.resolve(import.meta.dirname, '../../src/serverUtils/propuestas/skill');
const EJEMPLO = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets/ejemplo_contenido.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'propuestas-test-'));
const clone = () => JSON.parse(JSON.stringify(EJEMPLO));

let fallos = 0;
const ok = (m: string) => console.log('  ✓', m);
const bad = (m: string) => { fallos++; console.log('  ✗', m); };

// ── revisor ─────────────────────────────────────────────────────────────
const casos: [string, (c: any) => void][] = [
  ['ejemplo sin cambios', () => {}],
  ['punto de contexto sin fuente', c => { delete c.laminas[0].columnas[0].puntos[0].fuente; }],
  ['objetivo específico sin verbo en infinitivo', c => { c.laminas[1].especificos[0].titulo = 'Hábitos de consumo'; }],
  ['cajas de una fila con distinto número de puntos', c => { c.laminas[0].columnas[0].puntos.pop(); }],
  ['numeración con cero (01)', c => { c.laminas[7].titulo = '01 Hallazgos'; }],
  ['dos puntos como bisagra', c => { c.laminas[0].bisagra = 'Contexto: lo que sabemos'; }],
  ['«por cotizar»', c => { c.laminas[6].partidas[0].descripcion = 'Reclutamiento por cotizar'; }],
  ['precio sin cantidad en letra', c => { c.laminas[6].paquete.letra = ''; }],
  ['cajas con largo muy distinto', c => { c.laminas[0].columnas[0].puntos[0].texto = 'x'.repeat(400); }],
  ['letras espaciadas', c => { c.laminas[7].bisagra = 'a b c d e f g'; }],
  ['más de un «realiza»', c => { c.laminas[7].bisagra = 'Se realiza y realiza el estudio'; }],
  ['precio con formato distinto', c => { c.laminas[6].paquete.precio = '$1000 pesos'; }],
  ['partida a fase inexistente', c => { c.laminas[6].partidas[0].fase = 99; }],
  ['barra del cronograma fuera de semanas', c => { c.laminas[5].barras[0].fin = 99; }],
  ['menores sin consentimiento', c => { c.laminas[4].columnas[0] = '12 a 15 años'; c.laminas[4].notas = []; }],
  ['verbo cuantitativo en estudio cualitativo', c => { c.metodo = 'cualitativo'; c.laminas[1].especificos[0].titulo = 'Medir el consumo'; }],
  ['falta lámina de inversión', c => { c.laminas = c.laminas.filter((l: any) => l.tipo !== 'inversion'); }],
  ['acentos (unicode) en palabras sueltas', c => { c.laminas[7].bisagra = 'á é í ó ú ñ ü'; }],
];

console.log('Revisor: TS vs revisar.py');
for (const [nombre, mut] of casos) {
  const c = clone(); mut(c);
  const f = path.join(TMP, 'contenido.json');
  fs.writeFileSync(f, JSON.stringify(c), 'utf8');
  const py = spawnSync('python3', [path.join(SKILL, 'scripts/revisar.py'), f], { encoding: 'utf8' });
  const esperado = py.stdout.trim().split('\n').filter(Boolean);
  const ts = revisarContenido(c);
  const obtenido = ts.length ? ts.map(p => `[${p.ruta}] ${p.problema}`) : ['Sin problemas.'];
  const iguales = JSON.stringify(esperado) === JSON.stringify(obtenido) && (py.status === 1) === (ts.length > 0);
  if (iguales) ok(`${nombre} (${ts.length} problemas)`);
  else { bad(nombre); console.log('    python:', esperado, '\n    ts    :', obtenido); }
}
// Hallazgo: el ejemplo que viene en el zip NO sale limpio con el revisor
// original (el spec dice que sí). La paridad TS = Python se cumple igual; esto
// solo avisa, no falla.
if (revisarContenido(clone()).length !== 0) console.log('  ⚠ aviso: assets/ejemplo_contenido.json no sale «Sin problemas» ni con revisar.py original (ver los 2 problemas arriba)');

// ── constructor ─────────────────────────────────────────────────────────
console.log('Constructor: TS vs construir.js');
async function entradas(buf: Buffer): Promise<Map<string, string>> {
  const f = path.join(TMP, `${crypto.randomUUID()}.pptx`);
  fs.writeFileSync(f, buf);
  // python zipfile: `unzip -p` toma los corchetes de [Content_Types].xml como comodín
  const out = execFileSync('python3', ['-c', 'import sys,zipfile,hashlib,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:hashlib.sha1(z.read(n)).hexdigest() for n in z.namelist() if not n.endswith("/")}))', f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return new Map(Object.entries(JSON.parse(out)) as [string, string][]);
}
const ejemploPath = path.join(TMP, 'ejemplo.json');
fs.writeFileSync(ejemploPath, JSON.stringify(EJEMPLO), 'utf8');
const origOut = path.join(TMP, 'orig.pptx');
execFileSync('node', [path.join(SKILL, 'scripts/construir.js'), ejemploPath, origOut], { cwd: SKILL, stdio: 'pipe' });
const { buffer, ajustes } = await construirPropuesta(EJEMPLO, {}, { paridad: true });
const a = await entradas(fs.readFileSync(origOut));
const b = await entradas(buffer);
const sinMeta = (m: Map<string, string>) => new Map([...m].filter(([n]) => !n.startsWith('docProps/')));
const A = sinMeta(a), B = sinMeta(b);
const diffs = [...new Set([...A.keys(), ...B.keys()])].filter(n => A.get(n) !== B.get(n));
if (diffs.length === 0) ok(`${A.size} archivos del .pptx idénticos (sin docProps) — ${[...A.keys()].filter(n => /slides\/slide\d+\.xml$/.test(n)).length} láminas`);
else { bad('archivos distintos: ' + diffs.join(', ')); }
if (!Array.isArray(ajustes)) bad('ajustes debe ser arreglo'); else ok(`ajustes de paleta devueltos (${ajustes.length})`);

// paleta propia: los ajustes deben coincidir con lo que imprime el original
const conPaleta = clone(); conPaleta.paleta = { acento: 'FFEE99', secundario: 'AABBCC', fases: ['112233', '112244', '112255', '112266'] };
const pPath = path.join(TMP, 'paleta.json'); fs.writeFileSync(pPath, JSON.stringify(conPaleta), 'utf8');
const salida = execFileSync('node', [path.join(SKILL, 'scripts/construir.js'), pPath, path.join(TMP, 'paleta_orig.pptx')], { cwd: SKILL, encoding: 'utf8' });
const impresos = salida.split('\n').filter(l => /^\s{2}\S/.test(l)).map(l => l.trim());
const r2 = await construirPropuesta(conPaleta, {}, { paridad: true });
if (JSON.stringify(impresos) === JSON.stringify(r2.ajustes)) ok(`ajustes con paleta propia iguales a los del original (${impresos.length})`);
else { bad('ajustes de paleta distintos'); console.log('    original:', impresos, '\n    ts      :', r2.ajustes); }

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? '\n✅ todo igual al original' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
