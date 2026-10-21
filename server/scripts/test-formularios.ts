// Pruebas del motor de Tools → Formularios con la plantilla de ALONG 2 y respuestas inventadas.
// No toca la base. Uso: cd server && npx tsx scripts/test-formularios.ts
import assert from 'node:assert/strict';
import { evaluar, pantallas, definicionPublica, validarPantalla, describir } from '../../src/lib/formularios/motor';
import { ALONG2 } from '../../src/lib/formularios/plantillas/along2';
import type { Respuestas } from '../../src/lib/formularios/tipos';

const NSE_CMAS: Respuestas = { nse_escolaridad: 'lic', nse_banos: '2', nse_autos: '1', nse_internet: 'si', nse_trabajan: '1', nse_cuartos: '2' }; // 59+47+22+32+15+16 = 191 → C+
const NSE_C: Respuestas = { nse_escolaridad: 'prepa', nse_banos: '1', nse_autos: '1', nse_internet: 'si', nse_trabajan: '2', nse_cuartos: '1' }; // 27+24+22+32+31+8 = 144 → C

const base: Respuestas = {
  aviso: 'si', nombre: 'Persona de Prueba', celular: '5500000000', genero: 'mujer', edad: 34, cp: '01000', hogar: 'pareja_hijos',
  giros: ['ninguno'], estudio_previo: ['no'],
  rol: { super: 'yo', cocinar: 'yo', limpiar: 'compartido', aromatizar: 'yo', ropa: 'yo' },
  rechazo: ['ninguna'],
  tienda: 'walmart', sucursal: 'Sucursal Ejemplo', acuerdos: ['visita', 'tienda', 'personas', 'grabacion', 'videollamada'], horarios: ['sabado'],
};

const bloqueAerosol: Respuestas = {
  'aromas@aerosol': 'Lavanda', 'marcas@aerosol': ['glade'], 'favorita@aerosol': 'glade', 'lugar@aerosol': ['walmart'],
  'antiguedad@aerosol': '1a3a', 'ultima@aerosol': 'semana', 'espacios@aerosol': ['bano', 'sala'],
  'foto@aerosol': [{ ruta: 'prueba/foto.jpg', nombre: 'foto.jpg' }],
};

let pasaron = 0;
function caso(nombre: string, fn: () => void) { fn(); pasaron++; console.log(`✓ ${nombre}`); }

caso('usuaria de aerosol C+ califica en Aerosoles', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes', 'botanas'], formatos_uso: ['aerosol', 'velas'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.equal(r.terminado, undefined);
  assert.equal(r.incompleto, false, JSON.stringify(r));
  assert.equal(r.nse?.nivel, 'C+');
  assert.deepEqual(r.frentes, ['aerosol']);
  assert.equal(r.califica, true);
});

caso('el bloque se repite por formato comprado y usa el nombre corto', () => {
  const lista = pantallas(ALONG2, { ...base, categorias: ['aromatizantes'], formatos_uso: ['aerosol', 'varitas', 'velas'], formatos_compra: ['aerosol', 'varitas'] });
  const bloques = lista.filter((p) => p.seccion.id === 'aroma_bloque');
  assert.deepEqual(bloques.map((b) => b.id), ['aroma_bloque@aerosol', 'aroma_bloque@varitas']);
  assert.equal(bloques[1].titulo, 'Tu difusor de varitas');
});

caso('Lumerra termina el formulario', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol, 'marcas@aerosol': ['lumerra', 'glade'] });
  assert.match(r.terminado?.motivo ?? '', /Lumerra/);
  assert.equal(r.califica, false);
});

caso('rechazar Air Wick deja fuera los frentes de Air Wick', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, rechazo: ['airwick'], categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.deepEqual(r.frentes, []);
  assert.deepEqual(r.gruposExcluidos, ['airwick']);
});

caso('menos de 3 meses usándolo descarta ese formato, no el formulario', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol, 'antiguedad@aerosol': 'menos3m' });
  assert.equal(r.terminado, undefined);
  assert.equal(r.descartes.length, 1);
  assert.deepEqual(r.frentes, []);
});

caso('Brasso todo propósito que diluye, NSE C, califica', () => {
  const r = evaluar(ALONG2, {
    ...base, ...NSE_C, edad: 50, categorias: ['limpiadores'], tipos: ['todo_proposito'],
    'marcas_l@todo_proposito': ['fabuloso', 'brasso'], 'favorita_l@todo_proposito': 'brasso', 'variante@todo_proposito': 'Lavanda',
    'presentacion@todo_proposito': ['diluir'], 'tamano@todo_proposito': 'galon', 'lugar_l@todo_proposito': ['aurrera'],
    'ultima_l@todo_proposito': '2a4sem', 'diluye@todo_proposito': 'cubeta',
    foto_limpiadores: [{ ruta: 'prueba/l.jpg', nombre: 'l.jpg' }],
  });
  assert.equal(r.incompleto, false, JSON.stringify(r));
  assert.deepEqual(r.frentes, ['brasso']);
});

caso('42 años no entra a Brasso', () => {
  const r = evaluar(ALONG2, {
    ...base, ...NSE_C, edad: 42, categorias: ['limpiadores'], tipos: ['todo_proposito'],
    'marcas_l@todo_proposito': ['fabuloso'], 'favorita_l@todo_proposito': 'fabuloso', 'variante@todo_proposito': 'Lavanda',
    'presentacion@todo_proposito': ['diluir'], 'tamano@todo_proposito': 'galon', 'lugar_l@todo_proposito': ['aurrera'],
    'ultima_l@todo_proposito': '2a4sem', 'diluye@todo_proposito': 'cubeta', foto_limpiadores: [{ ruta: 'x', nombre: 'x' }],
  });
  assert.deepEqual(r.frentes, []);
});

caso('sin aromatizantes ni limpiadores termina', () => {
  const r = evaluar(ALONG2, { ...base, categorias: ['botanas', 'cafe'] });
  assert.match(r.terminado?.motivo ?? '', /No compra/);
});

caso('no aceptar todas las condiciones termina', () => {
  const r = evaluar(ALONG2, { ...base, acuerdos: ['visita', 'tienda'] });
  assert.match(r.terminado?.motivo ?? '', /condiciones/);
});

caso('edad fuera de rango termina', () => {
  assert.match(evaluar(ALONG2, { ...base, edad: 70 }).terminado?.motivo ?? '', /Edad/);
});

caso('faltan respuestas → incompleto y no califica', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol, 'foto@aerosol': [] });
  assert.equal(r.incompleto, true);
  assert.equal(r.califica, false);
});

caso('validación: celular de 10 dígitos y «Otra» pide cuál', () => {
  const lista = pantallas(ALONG2, { ...base, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'] });
  const perfil = lista.find((p) => p.id === 'perfil')!;
  assert.match(validarPantalla(perfil, { ...base, celular: '55' }).celular, /10 dígitos/);
  const bloque = lista.find((p) => p.id === 'aroma_bloque@aerosol')!;
  assert.match(validarPantalla(bloque, { ...bloqueAerosol, 'marcas@aerosol': ['otra'] })['marcas@aerosol'], /cuál/);
});

caso('la definición pública no lleva frentes, NSE ni motivos', () => {
  const pub = JSON.stringify(definicionPublica(ALONG2));
  assert.ok(!pub.includes('Lumerra, una marca'));
  assert.ok(!pub.includes('frentes') && !pub.includes('"puntos"') && !pub.includes('airwick"]'));
  assert.ok(!pub.includes('nota'));
});

caso('describir arma las líneas para el panel', () => {
  const secciones = describir(ALONG2, { ...base, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol, 'marcas@aerosol': ['glade', 'otra'], 'marcas@aerosol#otra': 'Marca X' });
  const bloque = secciones.find((s) => s.titulo === 'Tu aerosol')!;
  assert.ok(bloque.lineas.some((l) => l.valor.includes('Otra: Marca X')));
});

console.log(`\n${pasaron} pruebas pasaron`);
