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
  ['«el brief» y número suelto entre corchetes', c => { c.laminas[7].bisagra = 'Lo que dice el brief <12>'; }],
  ['título de lámina de más de un renglón', c => { c.laminas[7].titulo = 'Lo que necesitamos de Café Altura para arrancar'; }],
  ['lámina fuera de lugar entre muestra e inversión', c => { const k = c.laminas.findIndex((l: any) => l.tipo === 'seccion'); const [x] = c.laminas.splice(k, 1); c.laminas.splice(5, 0, x); }],
  ['muestra sin notas, con punto medio', c => { c.laminas[4].notas = []; c.laminas[4].filas[0].celdas[0] = '1 sesión · 6'; }],
  ['verbo suelto en el enfoque', c => { c.laminas[2].verbos[0][0] = 'Observar'; }],
  ['descripción de técnica de más de 2 renglones (11.5 pt)', c => { c.laminas[3].como[1].texto = 'Prepararemos café con cada participante y profundizaremos en lo que vimos en el diario, para entender cada gesto del ritual, sus tiempos, sus utensilios y lo que significa para quienes lo viven en casa todos los días, sin prisa y sin guion.'; }],
  ['pregunta binaria o absoluta', c => { c.laminas[1].especificos[0].puntos[0] = 'En qué momentos entra y en cuáles no'; }],
  ['columnas de muestra que mezclan fase y corte', c => { c.laminas[4].columnas[0] = 'Home Rituals en CDMX'; }],
  ['fase con participantes nuevos y muestra sin grupos', c => { c.fases[1].participantes = 'nuevos'; }],
  ['grupos que no suman las columnas', c => { c.laminas[4].grupos = [{ fase: 1, columnas: 2 }]; }],
  ['grupos bien formados (sin problemas de grupos)', c => { c.fases[1].participantes = 'nuevos'; c.laminas[4].grupos = [{ fase: 1, columnas: 3 }]; }],
  ['fase como nombre en grupos', c => { c.laminas[4].grupos = [{ fase: 'Home Rituals', columnas: 3, detalle: '12 participantes con visita' }]; }],
  ['grupo sin detalle', c => { c.laminas[4].grupos = [{ fase: 1, columnas: 3 }]; }],
  ['detalle de fase sin quienes (las fases declaran participantes)', c => { c.fases.forEach((f: any, k: number) => { f.participantes = k === 0 ? 'nuevos' : 'mismos'; }); }],
  ['fase como nombre en detalle de fase', c => { c.laminas[3].fase = 'Home Rituals'; }],
  ['cantidad en letra fuera de formato', c => { c.laminas[6].paquete.letra = 'Seiscientos veinte mil pesos 00/100 M.N.'; }],
];
// Contenido de prueba con errores (assets/): exactamente 24 problemas, iguales en Python y en TS.
const PRUEBA_VICTORIA = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets/prueba_victoria_con_errores.json'), 'utf8'));
casos.push(['prueba_victoria_con_errores.json (mismos problemas en Python y TS)', c => { Object.keys(c).forEach(k => delete c[k]); Object.assign(c, JSON.parse(JSON.stringify(PRUEBA_VICTORIA))); }]);

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
  if (nombre.startsWith('prueba_victoria')) console.log(`    (Victoria con errores: Python ${esperado.length} problemas, TS ${ts.length})`);
  if (nombre === 'ejemplo sin cambios' && ts.length !== 0) { bad(`${nombre}: debe salir «Sin problemas» y salieron ${ts.length}`); continue; }
  if (iguales) ok(`${nombre} (${ts.length} problemas)`);
  else { bad(nombre); console.log('    python:', esperado, '\n    ts    :', obtenido); }
}
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
const { buffer, ajustes } = await construirPropuesta(EJEMPLO);
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
const r2 = await construirPropuesta(conPaleta);
if (JSON.stringify(impresos) === JSON.stringify(r2.ajustes)) ok(`ajustes con paleta propia iguales a los del original (${impresos.length})`);
else { bad('ajustes de paleta distintos'); console.log('    original:', impresos, '\n    ts      :', r2.ajustes); }

// participantes visibles (conector del enfoque, `quienes`, `detalle`) y `fase` por nombre: idéntico al original
for (const acomodoEnfoque of ['circulos', 'banda']) for (const acomodoMuestra of ['tabla', 'celdas']) {
  const cp = clone();
  cp.fases.forEach((f: any, k: number) => { f.participantes = k === 0 ? 'nuevos' : (k === 1 ? 'mismos' : 'nuevos'); });
  cp.laminas[2].acomodo = acomodoEnfoque;
  cp.laminas[3].quienes = '12 participantes'; cp.laminas[3].fase = 'Home Rituals';
  cp.laminas[4].acomodo = acomodoMuestra;
  cp.laminas[4].grupos = [{ fase: 0, columnas: 2, detalle: '12 participantes con diario y entrevista' }, { fase: 'Home Rituals', columnas: 1, detalle: '6 en 1 sesión' }];
  const pPath2 = path.join(TMP, `part_${acomodoEnfoque}_${acomodoMuestra}.json`); fs.writeFileSync(pPath2, JSON.stringify(cp), 'utf8');
  const pOut = pPath2.replace('.json', '.pptx');
  execFileSync('node', [path.join(SKILL, 'scripts/construir.js'), pPath2, pOut], { cwd: SKILL, stdio: 'pipe' });
  const pts = await construirPropuesta(cp);
  const pa = sinMeta(await entradas(fs.readFileSync(pOut))), pb = sinMeta(await entradas(pts.buffer));
  const pd = [...new Set([...pa.keys(), ...pb.keys()])].filter(n => pa.get(n) !== pb.get(n));
  if (pd.length === 0) ok(`participantes visibles (enfoque ${acomodoEnfoque}, muestra ${acomodoMuestra}) idénticos al original`); else bad(`participantes visibles (${acomodoEnfoque}/${acomodoMuestra}) distintos: ` + pd.join(', '));
}

// defecto de pptxgenjs 4.0.1: un <a:pPr> a media línea (tras </a:r>) deja renglones sin flecha / archivo inválido.
// El buffer del constructor TS debe pasar por limpiarParrafos(): ningún slide trae la secuencia </a:r><a:pPr.
{
  const cc = clone();
  cc.laminas[4].notas = ['Usuarios de Café Altura <es la marca que más compran en casa> y usuarios de otras marcas <no han comprado en 6 meses>', 'Todos toman café en casa'];
  cc.laminas[3].como[0].texto = 'Cada participante nos compartirá sus momentos de café <qué prepara, con qué, con quién>, para ver el ritual real';
  const rr = await construirPropuesta(cc);
  const fcc = path.join(TMP, 'pPr.pptx'); fs.writeFileSync(fcc, rr.buffer);
  const salida = execFileSync('python3', ['-c', "import sys,zipfile,re\nz=zipfile.ZipFile(sys.argv[1])\nmalos=[n for n in z.namelist() if re.match(r'ppt/slides/slide\\d+\\.xml$',n) and '</a:r><a:pPr' in z.read(n).decode('utf8')]\nprint(','.join(malos))", fcc], { encoding: 'utf8' }).trim();
  if (salida === '') ok('ningún slide trae </a:r><a:pPr (limpiarParrafos aplicado, con <…> en notas y en «cómo»)'); else bad('XML con <a:pPr> a media línea en: ' + salida);
}

// muestra con `grupos` en los dos acomodos: el TS debe salir idéntico al original
for (const acomodo of ['tabla', 'celdas']) {
  const cg = clone(); cg.laminas[4].acomodo = acomodo; cg.laminas[4].grupos = [{ fase: 0, columnas: 2 }, { fase: 1, columnas: 1 }];
  const gPath = path.join(TMP, `grupos_${acomodo}.json`); fs.writeFileSync(gPath, JSON.stringify(cg), 'utf8');
  const gOut = path.join(TMP, `grupos_${acomodo}.pptx`);
  execFileSync('node', [path.join(SKILL, 'scripts/construir.js'), gPath, gOut], { cwd: SKILL, stdio: 'pipe' });
  const gts = await construirPropuesta(cg);
  const ga = sinMeta(await entradas(fs.readFileSync(gOut))), gb = sinMeta(await entradas(gts.buffer));
  const gd = [...new Set([...ga.keys(), ...gb.keys()])].filter(n => ga.get(n) !== gb.get(n));
  if (gd.length === 0) ok(`muestra con grupos (${acomodo}) idéntica al original`); else bad(`muestra con grupos (${acomodo}) distinta: ` + gd.join(', '));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fallos === 0 ? '\n✅ todo igual al original' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
