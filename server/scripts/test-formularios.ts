// Pruebas del motor de Tools → Formularios con las plantillas (ALONG 2 y la de todos los tipos) y respuestas
// inventadas. No toca la base. Uso: cd server && npx tsx scripts/test-formularios.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { evaluar, pantallas, pantallaDeMuestra, definicionPublica, validarPantalla, describir, terminacion, type Pantalla } from '../../src/lib/formularios/motor';
import { columnas, columnasPorRenombrar, nombreColumnaTablero, sinNombreCorto, type FilaRespuesta } from '../../src/lib/formularios/tabla';
import { construirExcel } from '../../src/lib/formularios/excel';
import { imagenesQueFaltan, revisarDefinicion } from '../../src/lib/formularios/revisar';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import { ALONG2 } from '../../src/lib/formularios/plantillas/along2';
import { PRUEBA_TIPOS } from '../../src/lib/formularios/plantillas/pruebaTipos';
import { leerDefinicion, type Definicion, type Respuestas } from '../../src/lib/formularios/tipos';
import { calcularNse, reglaNse, reglaVigente } from '../../src/lib/formularios/nse';
import { condicionEnPalabras, frenteEnPalabras, logicaDeOpcion, logicaDePregunta, logicaDeSeccion } from '../../src/lib/formularios/palabras';
import { filasFlujo, filasFlujoDeEstructura, mapaFlujo } from '../../src/lib/formularios/flujo';
import { duracionEstimada, duracionPorPerfil } from '../../src/lib/formularios/duracion';
import {
  GRUPOS_TIPOS, agregarOpcion, agregarPregunta, agregarSeccion, cambiarOpcion, cambiarPregunta, cambiarTipo, comoSimple, diferencias, esFija, idNuevo,
  moverPregunta, moverSeccion, preguntasParaCondicion, quitarOpcion, quitarPregunta, usosDeOpcion, usosDePregunta, usosDeSeccion,
} from '../../src/lib/formularios/editar';
import { TIPOS, forma, type Pregunta, type Seccion } from '../../src/lib/formularios/tipos';
import {
  asentarEstructura, avanceEscritura, compararEstructuras, revisarEstructura, type Estructura, conservarSinCambio, definicionVacia, estructuraDeDefinicion, firmaSeccion, generadorNuevo,
  minutosDeEstructura, ponerSeccion, prepararParaEscribir, seccionNse,
} from '../../src/lib/formularios/generador';
import { definicionParaIA, promptCambio, promptEstructura, promptLogica, promptNombres, promptSeccion } from '../../src/serverUtils/formularios/prompts';
import { EstructuraZ, RespuestaLogicaZ, RespuestaSeccionZ, sinVacios } from '../../src/serverUtils/formularios/esquemas';
import Anthropic from '@anthropic-ai/sdk';
import { errorDeLaIA, systemPrompt } from '../../src/serverUtils/formularios/claude';
import { conservarLogica, revisarNombres } from '../../src/serverUtils/formularios/generar';
import { chequeosListo } from '../../src/lib/formularios/listo';
import { conInicio, SECCION_INICIO } from '../../src/lib/formularios/inicio';
import JSZip from 'jszip';
import { documentoDeFiltro, nombreDocumento, textoDeBloques } from '../../src/lib/formularios/documento';
import { wordDeDocumento } from '../../src/serverUtils/formularios/documento';
import { compararIdentificacion, declaradoDe, edadDe } from '../../src/serverUtils/formularios/identificacion';
import { agruparTelefono, limpiarTelefono, telefonoDe } from '../../src/lib/formularios/paises';
import { sugerirCorreo } from '../../src/lib/formularios/correo';
import { recalificar } from '../../src/serverUtils/formularios/traer';
import { alternarMarca, leerFormato, sinFormato } from '../../src/lib/formularios/formato';
import { tramosDe } from '../../src/lib/formularios/documento';
import { leerCatalogoSepomex } from '../../src/serverUtils/formularios/codigosPostales';
import { direccionDeComponentes } from '../../src/serverUtils/formularios/direcciones';
import { aplicarParche, asentarIds, avisosDeLogica, cambiosEnPalabras, columnasQueCambian, conocidosDe, protegerNse } from '../../src/lib/formularios/ia';

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
const pendientes: Promise<void>[] = [];
function caso(nombre: string, fn: () => void | Promise<void>) {
  const r = fn();
  const ok = () => { pasaron++; console.log(`✓ ${nombre}`); };
  if (r instanceof Promise) pendientes.push(r.then(ok)); else ok();
}

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

caso('Lumerra no califica, pero no corta el filtro (contesta todo y se registra)', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol, 'marcas@aerosol': ['lumerra', 'glade'] });
  assert.match(r.noCalifica?.join() ?? '', /Lumerra/);
  assert.equal(r.terminado, undefined);
  assert.equal(r.califica, false);
});

caso('todos los motivos se registran; solo corta lo marcado «cortar» (y el aviso y la identificación)', () => {
  const r = evaluar(ALONG2, { ...base, edad: 70, giros: ['publicidad'] });
  assert.ok((r.noCalifica ?? []).length >= 2, JSON.stringify(r.noCalifica));
  assert.equal(r.terminado, undefined);
  assert.equal(terminacion(ALONG2, { ...base, edad: 70 }), undefined);
  // Con «cortar», ese criterio sí termina el filtro ahí.
  const conCorte = { ...ALONG2, secciones: ALONG2.secciones.map((s) => ({ ...s, preguntas: s.preguntas.map((p) => (p.id === 'edad' ? { ...p, terminaFuera: { ...p.terminaFuera!, cortar: true } } : p)) })) };
  assert.match(terminacion(conCorte, { ...base, edad: 70 })?.motivo ?? '', /Edad/);
  const edad = conCorte.secciones.flatMap((x) => x.preguntas).find((x) => x.id === 'edad')!;
  assert.match(logicaDePregunta(conCorte, edad).find((l) => l.campo === 'terminaFuera')!.texto, /no califica y se corta el filtro/);
});

caso('una persona traída de otro filtro no debe el aviso ni la identificación (ya los dio allá)', () => {
  const resp: Respuestas = {
    ...base, ...NSE_C, edad: 50, categorias: ['limpiadores'], tipos: ['todo_proposito'],
    'marcas_l@todo_proposito': ['fabuloso', 'brasso'], 'favorita_l@todo_proposito': 'brasso', 'variante@todo_proposito': 'Lavanda',
    'presentacion@todo_proposito': ['diluir'], 'tamano@todo_proposito': 'galon', 'lugar_l@todo_proposito': ['aurrera'],
    'ultima_l@todo_proposito': '2a4sem', 'diluye@todo_proposito': 'cubeta',
    foto_limpiadores: [{ ruta: 'prueba/l.jpg', nombre: 'l.jpg' }],
  };
  const def = conInicio(ALONG2);
  assert.equal(evaluar(def, resp).incompleto, true); // contestando hoy, sí le faltarían
  const traida = { formularioId: 'x', titulo: 'Filtro anterior', respuestaId: 'y', fecha: '2026-01-15T00:00:00.000Z' };
  const r = recalificar(def, resp, { ...evaluar(ALONG2, resp), traida });
  assert.equal(r.incompleto, false, JSON.stringify(r));
  assert.deepEqual(r.frentes, ['brasso']);
  assert.deepEqual(r.traida, traida);
});

caso('rechazar Air Wick deja fuera los perfiles de Air Wick', () => {
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

caso('sin aromatizantes ni limpiadores no califica', () => {
  const r = evaluar(ALONG2, { ...base, categorias: ['botanas', 'cafe'] });
  assert.match(r.noCalifica?.join() ?? '', /No compra/);
});

caso('no aceptar todas las condiciones no califica', () => {
  const r = evaluar(ALONG2, { ...base, acuerdos: ['visita', 'tienda'] });
  assert.match(r.noCalifica?.join() ?? '', /condiciones/);
});

caso('edad fuera de rango no califica', () => {
  assert.match(evaluar(ALONG2, { ...base, edad: 70 }).noCalifica?.join() ?? '', /Edad/);
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

// ── versión 2 del contrato ───────────────────────────────────────────────────
caso('las plantillas están bien armadas (una o varias dicho por el tipo, lógica que apunta a preguntas que existen)', () => {
  for (const [id, p] of Object.entries(PLANTILLAS)) assert.deepEqual(revisarDefinicion(p.definicion), [], id);
});

caso('la revisión encuentra lo mal armado', () => {
  const mal: Definicion = {
    ...PRUEBA_TIPOS,
    secciones: [{
      id: 's', preguntas: [
        { id: 'a', tipo: 'unica', texto: 'A', maxOpciones: 2, opciones: [{ id: 'x', label: 'X', exclusiva: true }] },
        { id: 'b', tipo: 'imagen_multiple', texto: 'B', opciones: [{ id: 'y', label: 'Y' }] },
        { id: 'c', tipo: 'escala', texto: 'C', opciones: [{ id: 'z', label: 'Z' }] },
      ],
    }],
    frentes: [], alertas: [], claves: {},
  };
  const problemas = revisarDefinicion(mal).join('\n');
  assert.match(problemas, /«a».*máximo de opciones/);
  assert.match(problemas, /«a».*exclusiva/);
  assert.doesNotMatch(problemas, /«b»/); // sin imágenes se guarda: es un pendiente de «¿Está listo?»
  assert.match(problemas, /«c».*no lleva opciones/);
  assert.match(problemas, /NSE suma «nse_escolaridad», que no existe/);
});

caso('una definición guardada en versión 1 se lee como la 2, con las mismas columnas y su NSE de 2018', () => {
  // Como el ensayo: versión 1, sin país, con los cortes de la AMAI 2018.
  const v1 = JSON.parse(JSON.stringify(ALONG2));
  v1.version = 1;
  delete v1.pais;
  v1.nse = { puntos: v1.nse.puntos, cortes: [{ nivel: 'A/B', desde: 205 }, { nivel: 'C+', desde: 166 }, { nivel: 'C', desde: 136 }, { nivel: 'C-', desde: 112 }, { nivel: 'D+', desde: 90 }, { nivel: 'D', desde: 48 }, { nivel: 'E', desde: 0 }] };
  const leida = leerDefinicion(v1);
  assert.equal(leida.version, 2);
  assert.equal(leida.pais, 'MX');
  assert.equal(leida.nse?.regla, 'AMAI 2018');
  assert.equal(leida.nse?.cortes[0].desde, 205, 'un filtro ya creado conserva su regla');
  assert.deepEqual({ ...leida, nse: undefined }, { ...JSON.parse(JSON.stringify(ALONG2)), nse: undefined });
  const claves = (d: Definicion) => columnas(d, [], { completas: true }).map((c) => c.clave);
  assert.deepEqual(claves(leida), claves(ALONG2));
  assert.ok(claves(ALONG2).includes('rol.aromatizar') && claves(ALONG2).includes('foto@aerosol'));
});

caso('México usa la AMAI 2022: mismos puntos que la 2018, cortes nuevos', () => {
  const regla = reglaNse('MX')!;
  assert.equal(regla.regla, 'AMAI 2022');
  assert.equal(regla.porConfirmar, undefined);
  assert.equal(reglaVigente('MX'), 'AMAI 2022');
  const nivel = (r: Respuestas) => calcularNse(regla, r)?.nivel;
  // 59+24+22+32+15+8 = 160: C en las dos. 59+47+0+32+15+16 = 169: C+ con la 2022 (desde 168).
  assert.equal(nivel({ nse_escolaridad: 'lic', nse_banos: '1', nse_autos: '1', nse_internet: 'si', nse_trabajan: '1', nse_cuartos: '1' }), 'C');
  assert.equal(nivel({ nse_escolaridad: 'lic', nse_banos: '2', nse_autos: '0', nse_internet: 'si', nse_trabajan: '1', nse_cuartos: '2' }), 'C+');
  // 85+47+43+32+0+0 = 207 → A/B; 27+24+22+32+0+8 = 113 → D+ (la 2018 decía C-, desde 112).
  assert.equal(nivel({ nse_escolaridad: 'doctorado', nse_banos: '2', nse_autos: '2', nse_internet: 'si', nse_trabajan: '0', nse_cuartos: '0' }), 'A/B');
  assert.equal(nivel({ nse_escolaridad: 'prepa', nse_banos: '1', nse_autos: '1', nse_internet: 'si', nse_trabajan: '0', nse_cuartos: '1' }), 'D+');
  // Carrera comercial y técnica van separadas, con los mismos puntos.
  assert.equal(regla.puntos.nse_escolaridad.comercial, 23);
  assert.equal(regla.puntos.nse_escolaridad.tecnica, 23);
});

// ── NSE: alerta, nunca descarte ──────────────────────────────────────────────
caso('NSE C en un perfil que pide C+: entra con alerta, no la saca', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_C, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.equal(r.nse?.nivel, 'C');
  assert.deepEqual(r.frentes, ['aerosol']);
  assert.equal(r.califica, true);
  assert.deepEqual(r.nse?.fueraDe, ['aerosol']);
  assert.ok(r.alertas.includes('NSE C, el perfil Aerosoles / Pure pide C+'), r.alertas.join(' | '));
});

caso('NSE que sí coincide: sin alerta', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.equal(r.nse?.fueraDe, undefined);
  assert.deepEqual(r.alertas, []);
});

caso('en un perfil con dos caminos, la alerta dice el NSE del camino por el que entró', () => {
  const brasso = {
    ...base, edad: 50, categorias: ['limpiadores'], tipos: ['todo_proposito'],
    'marcas_l@todo_proposito': ['fabuloso'], 'favorita_l@todo_proposito': 'fabuloso', 'variante@todo_proposito': 'Lavanda',
    'presentacion@todo_proposito': ['diluir'], 'tamano@todo_proposito': 'galon', 'lugar_l@todo_proposito': ['aurrera'],
    'ultima_l@todo_proposito': '2a4sem', 'diluye@todo_proposito': 'cubeta', foto_limpiadores: [{ ruta: 'x', nombre: 'x' }],
  };
  const r = evaluar(ALONG2, { ...brasso, ...NSE_CMAS });
  assert.deepEqual(r.frentes, ['brasso']);
  assert.ok(r.alertas.includes('NSE C+, el perfil Brasso / limpiadores pide C, C- o D+'), r.alertas.join(' | '));
  assert.deepEqual(evaluar(ALONG2, { ...brasso, ...NSE_C }).alertas, []);
});

// ── todos los tipos de pregunta (plantilla de prueba) ───────────────────────
const tipos: Respuestas = {
  aviso: 'si', nombre: 'Persona Prueba', celular: '5500000000', correo: 'persona@ejemplo.test', genero: 'mujer', edad: 30,
  domicilio: { calle: 'Calle Ejemplo', numero: '123 int. 4', colonia: 'Centro', ciudad: 'Cuauhtémoc', estado: 'Ciudad de México', cp: '06000' },
  tienda: 'supermercado', frutas: ['mango', 'pera'],
  empaque: 'lata', formatos: ['aerosol', 'vela'],
  frecuencia: { barrer: 'diario', trapear: 'semana', ropa: 'semana' },
  lugares: { aromatizante: ['casa', 'auto'], limpiador: ['casa'], toallitas: ['no_uso'] },
  mascota: 'no',
  probabilidad: 8, agrado: 4, peso_aroma: 70, atributos: ['aroma', 'precio', 'duracion', 'diseno', 'que_sea_facil_de_usar'],
  ...NSE_CMAS,
};
const pantalla = (r: Respuestas, id: string): Pantalla => pantallas(PRUEBA_TIPOS, r).find((p) => p.id === id)!;
const errores = (r: Respuestas, id: string) => validarPantalla(pantalla(r, id), r, PRUEBA_TIPOS.pais);

caso('con todos los tipos contestados califica en su perfil', () => {
  const r = evaluar(PRUEBA_TIPOS, tipos);
  assert.equal(r.incompleto, false, JSON.stringify(r));
  assert.equal(r.nse?.nivel, 'C+');
  assert.deepEqual(r.frentes, ['lata']);
  assert.deepEqual(r.alertas, []);
  assert.equal(r.califica, true);
});

caso('pantallas: la de solo texto e imagen existe y no pide nada', () => {
  const concepto = pantalla(tipos, 'concepto');
  assert.equal(concepto.preguntas[0].pregunta.tipo, 'contenido');
  assert.deepEqual(validarPantalla(concepto, {}), {});
});

caso('dirección: pide cada campo y el código postal de México', () => {
  const sinColonia = { ...tipos, domicilio: { ...(tipos.domicilio as Record<string, string>), colonia: ' ' } };
  assert.equal(errores(sinColonia, 'perfil').domicilio, 'Falta: Colonia');
  const cpCorto = { ...tipos, domicilio: { ...(tipos.domicilio as Record<string, string>), cp: '0600' } };
  assert.match(errores(cpCorto, 'perfil').domicilio, /5 dígitos/);
  assert.equal(errores({ ...tipos, domicilio: {} }, 'perfil').domicilio, 'Escribe tu dirección');
  assert.equal(errores(tipos, 'perfil').domicilio, undefined);
});

caso('listas: la desplegable termina con su opción y la múltiple respeta el tope', () => {
  assert.match(evaluar(PRUEBA_TIPOS, { ...tipos, tienda: 'nadie' }).noCalifica?.join() ?? '', /No hace compras/);
  assert.equal(errores({ ...tipos, frutas: ['mango', 'pera', 'uva', 'kiwi', 'lima', 'tuna'] }, 'compras').frutas, 'Marca máximo 5');
  assert.match(errores({ ...tipos, tienda: 'otra' }, 'compras').tienda, /cuál/);
});

caso('imágenes: la de una es obligatoria y la de varias cuenta para las alertas', () => {
  const { empaque: _, ...sinEmpaque } = tipos;
  assert.equal(errores(sinEmpaque, 'empaques').empaque, 'Contesta esta pregunta');
  const r = evaluar(PRUEBA_TIPOS, { ...tipos, formatos: ['aerosol', 'spray', 'vela', 'varitas'] });
  assert.ok(r.alertas.includes('Marcó los 4 aromatizantes'));
});

caso('matrices: cada fila contestada, de una o de varias', () => {
  assert.equal(errores({ ...tipos, frecuencia: { barrer: 'diario' } }, 'casa').frecuencia, 'Contesta todas las filas');
  assert.equal(errores({ ...tipos, lugares: { aromatizante: ['casa'], limpiador: [], toallitas: ['auto'] } }, 'casa').lugares, 'Contesta todas las filas');
  assert.deepEqual(errores(tipos, 'casa'), {});
});

caso('interruptor: «sí» abre la pregunta que depende de él', () => {
  assert.ok(!pantalla(tipos, 'casa').preguntas.some((p) => p.clave === 'mascota_cual'));
  const conMascota = { ...tipos, mascota: 'si' };
  assert.ok(pantalla(conMascota, 'casa').preguntas.some((p) => p.clave === 'mascota_cual'));
  assert.equal(evaluar(PRUEBA_TIPOS, conMascota).incompleto, true);
  assert.equal(evaluar(PRUEBA_TIPOS, { ...conMascota, mascota_cual: 'gato' }).incompleto, false);
});

caso('escalas, estrellas y deslizador: rango, sin contestar y alerta por número', () => {
  const { agrado: _a, peso_aroma: _p, ...sinNumeros } = tipos;
  const e = errores({ ...sinNumeros, probabilidad: 11 }, 'opinion');
  assert.equal(e.probabilidad, 'Contesta esta pregunta');
  assert.equal(e.agrado, 'Elige cuántas estrellas');
  assert.equal(e.peso_aroma, 'Mueve el deslizador');
  assert.ok(evaluar(PRUEBA_TIPOS, { ...tipos, agrado: 2 }).alertas.includes('Le dio 1 o 2 estrellas a la idea'));
});

caso('ordenar: pide ordenar todas', () => {
  assert.equal(errores({ ...tipos, atributos: ['aroma', 'precio'] }, 'opinion').atributos, 'Ordena todas las opciones');
});

caso('casilla: la obligatoria se marca para seguir; la opcional no', () => {
  assert.equal(errores({ ...tipos, aviso: 'no' }, 'inicio').aviso, 'Marca la casilla para continuar');
  const { aviso: _, ...sinAviso } = tipos;
  assert.equal(errores(sinAviso, 'inicio').aviso, 'Marca la casilla para continuar');
  assert.deepEqual(errores(tipos, 'cierre'), {});
});

caso('NSE en la plantilla de prueba: C en el perfil de lata da alerta', () => {
  const r = evaluar(PRUEBA_TIPOS, { ...tipos, ...NSE_C });
  assert.deepEqual(r.frentes, ['lata']);
  assert.equal(r.califica, true);
  assert.deepEqual(r.alertas, ['NSE C, el perfil Prefiere lata pide A/B o C+']);
});

caso('describir lee cada tipo en palabras y se salta lo que no se contesta', () => {
  const secciones = describir(PRUEBA_TIPOS, { ...tipos, whatsapp: 'si' });
  const linea = (texto: RegExp) => secciones.flatMap((s) => s.lineas).find((l) => texto.test(l.texto))?.valor;
  assert.equal(linea(/dirección/), 'Calle Ejemplo 123 int. 4, Centro, Cuauhtémoc, Ciudad de México, CP 06000');
  assert.equal(linea(/tipo de tienda/), 'Supermercado');
  assert.equal(linea(/frutas/), 'Mango, Pera');
  assert.equal(linea(/empaque/), 'Lata');
  assert.equal(linea(/Dónde usas/), 'Aromatizante: Casa, Auto · Limpiador: Casa · Toallitas: No lo uso');
  assert.equal(linea(/probable/), '8 de 10');
  assert.equal(linea(/te gusta/), '4 de 5');
  assert.equal(linea(/pesa el aroma/), '70 de 100');
  assert.equal(linea(/Ordena/), '1. Aroma, 2. Precio, 3. Duración, 4. Diseño, 5. Que sea fácil de usar');
  assert.equal(linea(/mascota/), 'No');
  assert.equal(linea(/contacten por WhatsApp/), 'Sí');
  assert.ok(!secciones.some((s) => s.titulo === 'Una idea nueva'), 'la pantalla de solo contenido no sale');
});

const fila = (r: Respuestas): FilaRespuesta => ({ createdAt: '2026-10-22T18:00:00.000Z', esPrueba: true, respuestas: r, resultado: evaluar(PRUEBA_TIPOS, r) });

caso('columnas: dirección por campo, matriz por fila, escalas como número y sin columna para el contenido', () => {
  const cols = columnas(PRUEBA_TIPOS, [fila(tipos)], { completas: true });
  const col = (clave: string) => cols.find((c) => c.clave === clave);
  assert.deepEqual(cols.filter((c) => c.clave.startsWith('domicilio.')).map((c) => c.titulo.split(' · ')[1]),
    ['Calle', 'Número exterior e interior', 'Colonia', 'Alcaldía o municipio', 'Estado', 'Código postal']);
  assert.equal(col('domicilio.cp')!.valor(fila(tipos)), '06000');
  assert.equal(col('lugares.aromatizante')!.valor(fila(tipos)), 'Casa, Auto');
  assert.equal(col('frecuencia.barrer')!.valor(fila(tipos)), 'Diario');
  for (const clave of ['probabilidad', 'agrado', 'peso_aroma', 'edad']) assert.equal(col(clave)!.tipo, 'Número', clave);
  assert.equal(col('agrado')!.valor(fila(tipos)), 4);
  assert.equal(col('atributos')!.valor(fila(tipos)), '1. Aroma, 2. Precio, 3. Duración, 4. Diseño, 5. Que sea fácil de usar');
  assert.equal(col('mascota')!.valor(fila(tipos)), 'No');
  assert.equal(col('formatos')!.valor(fila(tipos)), 'Aerosol, Vela');
  assert.equal(col('instrucciones'), undefined);
  assert.equal(col('concepto_gotas'), undefined);
});

caso('la definición pública lleva el país y las imágenes, sin frentes ni NSE', () => {
  const pub = definicionPublica(PRUEBA_TIPOS);
  assert.equal(pub.pais, 'MX');
  assert.ok(pub.secciones.find((s) => s.id === 'empaques')!.preguntas[0].opciones!.every((o) => o.imagen?.startsWith('data:image/svg+xml')));
  assert.equal(pub.frentes, undefined);
  assert.equal(pub.nse, undefined);
  assert.equal(pub.alertas, undefined);
});

caso('el Excel trae una columna por campo y por fila, con números donde va número', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('sin red en las pruebas'))) as typeof fetch; // sin logo
  try {
    const buf = await construirExcel('Prueba', PRUEBA_TIPOS, [fila(tipos), fila({ ...tipos, ...NSE_C, nombre: 'Otra Persona' })]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Respuestas')!;
    const encabezados = (ws.getRow(6).values as unknown[]).slice(1).map(String);
    const celda = (r: number, titulo: RegExp) => ws.getRow(r).getCell(encabezados.findIndex((t) => titulo.test(t)) + 1).value;
    assert.equal(celda(7, /Código postal/), '06000');
    assert.equal(celda(7, /^Dónde usa cada producto · Aromatizante$/), 'Casa, Auto');
    assert.equal(celda(7, /^Agrado$/), 4);
    assert.equal(celda(8, /^Alertas$/), 'NSE C, el perfil Prefiere lata pide A/B o C+');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ── fase 2: editor ───────────────────────────────────────────────────────────
const pregunta = (d: Definicion, id: string) => d.secciones.flatMap((x) => x.preguntas).find((p) => p.id === id)!;

caso('la lógica en palabras dice lo que hace el motor: cada opción que termina, termina con su motivo', () => {
  let revisadas = 0;
  for (const s of ALONG2.secciones) {
    if (s.repetirPor || s.mostrarSi) continue;
    for (const p of s.preguntas) {
      for (const o of p.opciones ?? []) {
        if (!o.termina) continue;
        const r = evaluar(ALONG2, { ...base, [p.id]: forma(p.tipo) === 'una' ? o.id : [o.id] });
        assert.ok(r.noCalifica?.includes(o.termina), `${p.id}/${o.id}`);
        const linea = logicaDeOpcion(ALONG2, p, o).find((l) => l.tipo === 'termina')!;
        assert.equal(linea.motivo, o.termina);
        assert.match(linea.texto, forma(p.tipo) === 'una' ? /^Si contesta esta, no califica: / : /^Si la marca, no califica: /);
        revisadas++;
      }
    }
  }
  assert.equal(revisadas, 7);
});

caso('la lógica en palabras de ALONG 2 se lee como la escribiría una persona', () => {
  const s = (id: string) => ALONG2.secciones.find((x) => x.id === id)!;
  assert.equal(logicaDeSeccion(ALONG2, s('aroma_formatos'))[0].texto, 'Solo aparece si marcó Aromatizantes para la casa o el auto en «¿Cuáles de estos productos compras tú para tu casa?».');
  assert.match(logicaDeSeccion(ALONG2, s('limp_bloque'))[0].texto, /Se repite por cada opción que marcó en «¿Qué tipos de limpiador compras para tu casa\?» \(solo Todo propósito, Multiusos o Especializado\)/);
  const brasso = ALONG2.frentes!.find((f) => f.id === 'brasso')!;
  assert.match(frenteEnPalabras(ALONG2, brasso), /^Entra si contestó de 25 a 40 o de 45 a 65 en «¿Cuántos años tienes\?» y alguna de estas: \(tiene el bloque «Tu limpiador especializado» sin descartarlo, /);
  assert.match(frenteEnPalabras(ALONG2, brasso), /El NSE no saca a nadie/);
  const acuerdos = logicaDePregunta(ALONG2, pregunta(ALONG2, 'acuerdos')).find((l) => l.campo === 'terminaSi')!;
  assert.equal(acuerdos.prefijo, 'No califica si no marcó todas las opciones de «Marca todo con lo que estás de acuerdo»: ');
  const antiguedad = pregunta(ALONG2, 'antiguedad').opciones!.find((o) => o.id === 'menos3m')!;
  assert.equal(logicaDeOpcion(ALONG2, pregunta(ALONG2, 'antiguedad'), antiguedad)[0].texto, 'Si contesta esta, no cuenta este bloque: Menos de 3 meses usándolo.');
  assert.equal(condicionEnPalabras({ pregunta: 'espacios', instancia: 'esfera', incluye: ['auto'] }, ALONG2), 'marcó Auto en «¿En qué lugares lo usas?» (en el bloque de adorno o esfera aromática)');
  assert.equal(condicionEnPalabras({ pregunta: 'mascota', incluye: ['si'] }, PRUEBA_TIPOS), 'contestó Sí en «¿Tienes mascota?»');
});

caso('el mapa del flujo marca lo que se repite, lo que aparece si aplica, dónde termina y qué toca perfiles', () => {
  const mapa = mapaFlujo(ALONG2);
  const b = (id: string) => mapa.find((x) => x.id === id)!;
  assert.equal(mapa.length, ALONG2.secciones.length);
  assert.match(b('aroma_bloque').repite ?? '', /últimos 3 meses/);
  assert.deepEqual(b('aroma_bloque').descarta.length, 2);
  assert.ok(b('aroma_bloque').frentes.includes('Aerosoles / Pure'));
  assert.ok(!b('aroma_bloque').frentes.includes('Brasso / limpiadores'));
  assert.match(b('aroma_formatos').condicion ?? '', /^Solo si marcó Aromatizantes/);
  assert.equal(b('filtros').termina.length, 6);
  assert.ok(b('rechazo').excluye.includes('Reeds') && b('rechazo').excluye.includes('Brasso / limpiadores'));
  assert.deepEqual(b('aroma_formatos').alertas, ['Marcó más de 7 aromatizantes: posible sobredeclarante']);
  assert.equal(b('nse').nse, true);
  assert.equal(b('aviso').nse, false);
  assert.equal(mapaFlujo(PRUEBA_TIPOS).find((x) => x.id === 'concepto')!.soloContenido, true);
});

caso('el flujo como diagrama: pasos para todos y ramas lado a lado que se juntan', () => {
  const filas = filasFlujo(ALONG2);
  const vista = filas.map((f) => (f.tipo === 'paso' ? f.bloque.id : f.ramas.map((r) => r.map((b) => b.id).join('>')).join('|')));
  assert.deepEqual(vista, ['aviso', 'perfil', 'filtros', 'compras', 'aroma_formatos>aroma_bloque|limp_tipos>limp_bloque>limp_foto', 'rechazo', 'nse', 'participacion']);
  const ramas = filas[4];
  assert.ok(ramas.tipo === 'ramas' && ramas.ramas[0][1].repiteDe === 'Formatos que compró');
  assert.ok(filasFlujo(PRUEBA_TIPOS).every((f) => f.tipo === 'paso'));
});

caso('la duración estimada de ALONG 2 ronda los 10 minutos y sube al agregar preguntas', () => {
  const d = duracionEstimada(ALONG2);
  assert.ok(d.tipico >= 8 && d.tipico <= 12, JSON.stringify(d));
  assert.ok(d.maximo > d.tipico);
  assert.ok(duracionEstimada(PRUEBA_TIPOS).tipico <= 10);
  let mas = ALONG2;
  for (let i = 0; i < 6; i++) mas = agregarPregunta(mas, 'perfil', 'foto').def;
  assert.ok(duracionEstimada(mas).tipico >= d.tipico + 3);
});

caso('un id nuevo es al azar, sin separadores y nunca repite uno que ya existe', () => {
  const usados = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = idNuevo('p', usados);
    assert.match(id, /^p_[0-9a-z]{6}$/);
    assert.ok(!usados.has(id));
    usados.add(id);
  }
  let vuelta = 0;
  const azar = () => [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5][vuelta++ % 12];
  assert.equal(idNuevo('o', ['o_000000'], azar), 'o_iiiiii');
});

caso('una pregunta nueva de cada tipo queda bien armada (al selector con imágenes le faltan, sin impedir guardar)', () => {
  for (const g of GRUPOS_TIPOS) {
    for (const tipo of g.tipos) {
      const { def, id } = agregarPregunta(PRUEBA_TIPOS, 'cierre', tipo);
      assert.deepEqual(revisarDefinicion(def), [], tipo);
      const faltan = imagenesQueFaltan(def).filter((x) => x.pregunta.id === id);
      assert.equal(faltan.length, tipo === 'imagen_unica' || tipo === 'imagen_multiple' ? 1 : 0, tipo);
    }
  }
  assert.equal(GRUPOS_TIPOS.flatMap((g) => g.tipos).length, Object.keys(TIPOS).length);
});

caso('una imagen que no está en una dirección pública no se guarda', () => {
  const conBlob = cambiarOpcion(PRUEBA_TIPOS, 'empaque', 'lata', { imagen: 'blob:http://localhost:5173/abc' });
  assert.match(revisarDefinicion(conBlob).join(' '), /la imagen de «Lata» no está en una carpeta pública/);
  const arriba = cambiarPregunta(PRUEBA_TIPOS, 'genero', { imagen: 'http://ejemplo.test/a.jpg' });
  assert.match(revisarDefinicion(arriba).join(' '), /«genero»: su imagen no está en una carpeta pública/);
  assert.deepEqual(revisarDefinicion(cambiarPregunta(PRUEBA_TIPOS, 'genero', { imagen: 'https://ejemplo.test/a.jpg' })), []);
});

caso('cambiar de tipo conserva los ids y quita lo que el tipo nuevo no admite', () => {
  const giros = pregunta(ALONG2, 'giros');
  const unica = pregunta(cambiarTipo(ALONG2, 'giros', 'unica'), 'giros');
  assert.deepEqual(unica.opciones!.map((o) => o.id), giros.opciones!.map((o) => o.id));
  assert.ok(!unica.opciones!.some((o) => o.exclusiva));
  assert.ok(unica.opciones!.some((o) => o.termina));
  const orden = pregunta(cambiarTipo(ALONG2, 'giros', 'ordenar'), 'giros');
  assert.ok(!orden.opciones!.some((o) => o.termina || o.exclusiva));
  const texto = pregunta(cambiarTipo(ALONG2, 'giros', 'texto'), 'giros');
  assert.equal(texto.opciones, undefined);
  const edad = pregunta(cambiarTipo(ALONG2, 'edad', 'escala'), 'edad');
  assert.equal(edad.min, undefined);
  assert.equal(edad.terminaFuera, undefined);
  const deslizador = pregunta(cambiarTipo(PRUEBA_TIPOS, 'probabilidad', 'deslizador'), 'probabilidad');
  assert.deepEqual(deslizador.etiquetas, { min: 'Nada probable', max: 'Muy probable' });
  const matriz = pregunta(cambiarTipo(PRUEBA_TIPOS, 'frecuencia', 'matriz_multiple'), 'frecuencia');
  assert.deepEqual(matriz.filas!.map((f) => f.id), ['barrer', 'trapear', 'ropa']);
  for (const [id, tipo] of [['giros', 'unica'], ['tienda', 'unica'], ['frecuencia', 'matriz_multiple'], ['probabilidad', 'deslizador'], ['comentarios', 'texto']] as const) {
    const def = id === 'giros' ? ALONG2 : PRUEBA_TIPOS;
    assert.deepEqual(revisarDefinicion(cambiarTipo(def, id, tipo)), [], `${id} → ${tipo}`);
  }
  // Lo que otra lógica necesita del tipo lo dice la revisión, para deshacer.
  assert.match(revisarDefinicion(cambiarTipo(ALONG2, 'formatos_compra', 'unica')).join(' '), /se repite por «formatos_compra», que no es de varias respuestas/);
});

caso('editar no cambia las claves de columna de lo que ya existía', () => {
  const antes = columnas(ALONG2, [], { completas: true }).map((c) => c.clave);
  let d = cambiarPregunta(ALONG2, 'edad', { texto: '¿Qué edad tienes?' });
  d = cambiarOpcion(d, 'genero', 'mujer', { label: 'Mujer (cis o trans)' });
  d = agregarOpcion(d, 'formatos_uso', 'Popurrí').def;
  d = agregarPregunta(d, 'perfil', 'unica', 2).def;
  d = moverPregunta(d, 'hogar', -1);
  d = moverSeccion(d, 'rechazo', -1);
  d = agregarSeccion(d, 3).def;
  const despues = new Set(columnas(d, [], { completas: true }).map((c) => c.clave));
  for (const clave of antes) assert.ok(despues.has(clave), clave);
  assert.ok(despues.has('aromas@' + pregunta(d, 'formatos_uso').opciones!.find((o) => o.label === 'Popurrí')!.id));
  assert.deepEqual(revisarDefinicion(d), []);
});

caso('una pregunta no se mueve a otra sección que se repite distinto (cambiaría su columna)', () => {
  const primera = ALONG2.secciones.find((x) => x.id === 'aroma_bloque')!.preguntas[0].id;
  assert.equal(moverPregunta(ALONG2, primera, -1), ALONG2);
  const ultimaPerfil = ALONG2.secciones.find((x) => x.id === 'perfil')!.preguntas.at(-1)!.id;
  const movida = moverPregunta(ALONG2, ultimaPerfil, 1);
  assert.equal(movida.secciones.find((x) => x.id === 'filtros')!.preguntas[0].id, ultimaPerfil);
});

caso('la revisión no deja que la lógica dependa de algo que va después', () => {
  const alReves = moverSeccion(ALONG2, 'aroma_formatos', -1);
  assert.match(revisarDefinicion(alReves).join(' '), /la sección «aroma_formatos» se usa «categorias», que va después/);
  const compraAntes = moverPregunta(ALONG2, 'formatos_compra', -1);
  assert.match(revisarDefinicion(compraAntes).join(' '), /«formatos_compra»: sus opciones salen de «formatos_uso», que va después/);
  assert.deepEqual(revisarDefinicion(ALONG2), []);
});

caso('antes de quitar algo se sabe dónde se usa', () => {
  assert.ok(usosDePregunta(ALONG2, 'edad').includes('el perfil Aerosoles / Pure'));
  assert.ok(usosDePregunta(ALONG2, 'nombre').includes('el nombre que muestra el panel'));
  assert.deepEqual(usosDePregunta(ALONG2, 'sucursal'), []);
  const usos = usosDeOpcion(ALONG2, 'categorias', 'aromatizantes');
  assert.ok(usos.includes('cuándo aparece la sección «Aromatizantes»'));
  assert.ok(usos.some((u) => u.startsWith('cuándo termina el filtro en «¿Cuáles de estos productos')));
  assert.deepEqual(usosDeOpcion(ALONG2, 'categorias', 'cafe'), []);
  assert.ok(usosDeOpcion(ALONG2, 'formatos_uso', 'aerosol').includes('el perfil Aerosoles / Pure'));
  assert.deepEqual(usosDeSeccion(ALONG2, 'participacion'), []);
  assert.ok(usosDeSeccion(ALONG2, 'limp_bloque').includes('el perfil Brasso / limpiadores'));
  const sinSucursal = quitarPregunta(ALONG2, 'sucursal');
  assert.deepEqual(revisarDefinicion(sinSucursal), []);
  assert.deepEqual(revisarDefinicion(quitarOpcion(ALONG2, 'categorias', 'cafe')), []);
});

caso('«mostrar solo si» simple: qué preguntas se pueden usar y cómo se guarda', () => {
  const candidatas = preguntasParaCondicion(PRUEBA_TIPOS, { seccion: 'casa', pregunta: 'mascota_cual' }).map((p) => p.id);
  assert.ok(candidatas.includes('mascota') && candidatas.includes('genero'));
  assert.ok(!candidatas.includes('mascota_cual') && !candidatas.includes('probabilidad') && !candidatas.includes('nombre'));
  // Una pregunta de una sección que se repite solo sirve dentro de esa misma repetición.
  assert.ok(!preguntasParaCondicion(ALONG2, { seccion: 'rechazo' }).some((p) => p.id === 'marcas'));
  assert.ok(preguntasParaCondicion(ALONG2, { seccion: 'aroma_bloque', pregunta: 'espacios' }).some((p) => p.id === 'marcas'));
  assert.deepEqual(comoSimple(pregunta(PRUEBA_TIPOS, 'mascota_cual').mostrarSi), { pregunta: 'mascota', incluye: ['si'] });
  assert.equal(comoSimple(pregunta(ALONG2, 'formatos_compra').mostrarSi), undefined); // «no marcó Ninguno»: se lee, no se edita aquí
  const d = cambiarPregunta(PRUEBA_TIPOS, 'comentarios', { mostrarSi: { pregunta: 'genero', incluye: ['mujer'] } });
  assert.deepEqual(revisarDefinicion(d), []);
  assert.deepEqual(pantallas(d, { genero: 'hombre' }).find((x) => x.id === 'cierre')!.preguntas.map((p) => p.pregunta.id), ['foto_producto', 'whatsapp']);
});

caso('comparar una versión con lo de ahora, en palabras', () => {
  assert.deepEqual(diferencias(ALONG2, ALONG2), []);
  const ahora = agregarPregunta(cambiarPregunta(ALONG2, 'edad', { texto: 'Edad' }), 'perfil', 'texto').def;
  assert.deepEqual(diferencias(ahora, ALONG2), ['Le falta 1 pregunta de hoy', '1 texto distinto']);
  assert.deepEqual(diferencias(ALONG2, quitarOpcion(ALONG2, 'categorias', 'cafe')), ['Le falta 1 opción de hoy']);
  assert.deepEqual(diferencias(ALONG2, cambiarTipo(ALONG2, 'giros', 'unica')), ['1 pregunta con otra lógica, tipo u orden de opciones']);
});

// ── fase 3: generador con IA (lógica pura; la IA no se llama aquí) ──────────
caso('la estructura de un filtro escrito se lee completa y da casi los mismos minutos', () => {
  const e = estructuraDeDefinicion(ALONG2);
  assert.equal(e.secciones.length, ALONG2.secciones.length);
  assert.equal(e.secciones.find((s) => s.id === 'nse')?.nse, true);
  assert.equal(e.secciones.find((s) => s.id === 'aroma_bloque')?.repetirPor, 'formatos_compra');
  assert.match(e.secciones.find((s) => s.id === 'aroma_formatos')?.aparece ?? '', /marcó Aromatizantes/);
  assert.match(e.frentes.find((f) => f.id === 'brasso')?.quien ?? '', /^Entra si/);
  const giros = e.secciones.find((s) => s.id === 'filtros')!.preguntas.find((p) => p.id === 'giros')!;
  assert.match(giros.logica ?? '', /«Publicidad o marketing»: Si la marca, no califica/);
  // El boceto de la estructura da casi los mismos minutos que el screener escrito (no lleva la bienvenida ni las ayudas).
  const m = minutosDeEstructura(e).total;
  const real = duracionEstimada(ALONG2);
  assert.ok(Math.abs(m.tipico - real.tipico) <= 1 && Math.abs(m.maximo - real.maximo) <= 1, JSON.stringify({ m, real }));
  const porSeccion = minutosDeEstructura(e).porSeccion;
  assert.ok(porSeccion.aroma_bloque.maximo > porSeccion.aroma_bloque.tipico);
});

caso('comparar estructuras: qué se conserva, qué se reescribe y qué sale', () => {
  const base = estructuraDeDefinicion(ALONG2);
  const nueva = structuredClone(base);
  nueva.secciones = nueva.secciones.filter((s) => s.id !== 'rechazo');
  nueva.secciones.find((s) => s.id === 'perfil')!.preguntas[0].texto = 'Tu nombre completo';
  nueva.secciones.push({ id: 'extra', titulo: 'Extra', para: 'probar', preguntas: [{ id: 'nueva', tipo: 'texto', texto: '¿Algo más?' }] });
  const r = compararEstructuras(base, nueva);
  assert.equal(r.secciones.perfil, 'cambia');
  assert.equal(r.secciones.compras, 'igual');
  assert.equal(r.secciones.extra, 'nueva');
  assert.deepEqual(r.salen, ['rechazo']);
  // «cambia: false» deja la sección de la base tal cual, aunque la IA haya cambiado la redacción.
  const conservada = conservarSinCambio(base, { ...nueva, secciones: nueva.secciones.map((s) => (s.id === 'perfil' ? { ...s, cambia: false } : s)) });
  assert.equal(compararEstructuras(base, conservada).secciones.perfil, 'igual');
  assert.ok(!('cambia' in conservada.secciones[0]));
});

caso('la estructura de la IA recibe ids nuevos y conserva los de la base', () => {
  const propuesta: Estructura = {
    pais: 'MX', tituloPublico: 'Estudio sobre bebidas', perfil: 'Toman café frío.',
    frentes: [{ id: 'cafeteros', nombre: 'Cafeteros', grupo: 'cliente', meta: 8, quien: 'Toma café frío cada semana.' }],
    secciones: [
      { id: 'bebidas', titulo: 'Bebidas', para: 'qué toma', preguntas: [{ id: 'cuales', tipo: 'multiple', texto: '¿Cuáles tomas?', opciones: [{ id: 'cafe', label: 'Café frío', corto: 'café frío' }, { id: 'te', label: 'Té' }] }] },
      { id: 'bloque', titulo: 'Tu {opcion}', para: 'detalle', repetirPor: 'cuales', repetirSolo: ['cafe'], preguntas: [{ id: 'frec', tipo: 'unica', texto: '¿Cada cuánto?', opciones: [{ id: 'diario', label: 'Diario' }] }] },
      { id: 'nse', titulo: 'Tu hogar', para: 'NSE', nse: true, preguntas: [] },
    ],
    supuestos: ['Tomé la edad de la propuesta.'],
  };
  assert.deepEqual(revisarEstructura(propuesta), []);
  const e = asentarEstructura(propuesta, undefined);
  const [bebidas, bloque] = e.secciones;
  assert.match(bebidas.id, /^s_/);
  assert.match(bebidas.preguntas[0].id, /^p_/);
  assert.equal(bloque.repetirPor, bebidas.preguntas[0].id);
  assert.deepEqual(bloque.repetirSolo, [bebidas.preguntas[0].opciones![0].id]);
  assert.match(e.frentes[0].id, /^fr_/);
  // Al ajustar, lo que ya existía conserva su id.
  const ajustada = structuredClone(e);
  ajustada.secciones[0].preguntas.push({ id: 'nuevo_lugar', tipo: 'unica', texto: '¿Dónde lo compras?', opciones: [{ id: 'nuevo_a', label: 'Cafetería' }] });
  const otra = asentarEstructura(ajustada, e);
  assert.equal(otra.secciones[0].id, bebidas.id);
  assert.equal(otra.secciones[0].preguntas[0].id, bebidas.preguntas[0].id);
  assert.match(otra.secciones[0].preguntas[1].id, /^p_/);
  assert.equal(otra.frentes[0].id, e.frentes[0].id);
  // Lo mal armado se dice en palabras.
  assert.ok(revisarEstructura({ ...propuesta, frentes: [] }).some((x) => x.startsWith('No hay perfiles')));
  assert.ok(revisarEstructura({ ...propuesta, secciones: [propuesta.secciones[1], propuesta.secciones[0]] }).some((x) => x.includes('no va antes')));
});

caso('al escribir, cada sección cae en su lugar y se sabe qué falta', () => {
  const e = estructuraDeDefinicion(ALONG2);
  const vacia = { ...definicionVacia(), secciones: [] };
  let d = ponerSeccion(vacia, ALONG2.secciones[3], e);
  d = ponerSeccion(d, ALONG2.secciones[0], e);
  d = ponerSeccion(d, ALONG2.secciones[1], e);
  assert.deepEqual(d.secciones.map((s) => s.id), ['aviso', 'perfil', 'compras']);
  d = ponerSeccion(d, { ...ALONG2.secciones[1], titulo: 'Sobre ti (nueva)' }, e);
  assert.deepEqual(d.secciones.map((s) => s.titulo), ['Antes de empezar', 'Sobre ti (nueva)', 'Lo que compras para tu casa']);
  const nse = seccionNse(e.secciones.find((s) => s.id === 'nse')!, 'MX')!;
  assert.equal(nse.preguntas.length, 6);
  assert.equal(ponerSeccion(d, nse, e).nse?.regla, 'AMAI 2022');
  assert.equal(seccionNse(e.secciones.find((s) => s.id === 'nse')!, 'PE'), undefined); // Perú aún no tiene regla cargada

  const g = generadorNuevo('insumos');
  g.estructura = e;
  g.aplicadas = { aviso: firmaSeccion(e.secciones[0]) };
  g.escritas = { perfil: { seccion: ALONG2.secciones[1], firma: firmaSeccion(e.secciones[1]) }, filtros: { seccion: ALONG2.secciones[2], firma: 'vieja' } };
  const a = avanceEscritura(g);
  assert.equal(a.listas, 1);
  assert.ok(a.porPoner.includes('perfil') && a.porPoner.includes('nse'));
  assert.ok(a.porEscribir.includes('filtros') && !a.porEscribir.includes('aviso'));

  const lista = prepararParaEscribir(ALONG2, { ...e, pais: 'MX', tituloPublico: 'Otro título', frentes: e.frentes.filter((f) => f.id !== 'brasso') }, ['rechazo']);
  assert.ok(!lista.secciones.some((s) => s.id === 'rechazo'));
  assert.equal(lista.tituloPublico, 'Otro título');
  assert.ok(!lista.frentes!.some((f) => f.id === 'brasso'));
});

caso('lo que propone la IA nunca cambia los ids que ya existen y lo nuevo lleva id nuevo', () => {
  const giros = pregunta(ALONG2, 'giros');
  const propuesta: Pregunta = {
    ...giros,
    id: 'giros',
    opciones: [
      ...giros.opciones!.filter((o) => o.id !== 'gobierno'),
      { id: 'comercio', label: 'Comercio' },
      { id: 'bancos', label: 'Bancos, seguros o afores' },
    ],
  };
  const r = asentarIds({ preguntas: [propuesta] }, conocidosDe(ALONG2, ['giros']), ALONG2);
  const q = r.preguntas![0];
  assert.equal(q.id, 'giros');
  assert.ok(q.opciones!.some((o) => o.id === 'publicidad' && o.termina));
  const comercio = q.opciones!.find((o) => o.label === 'Comercio')!;
  assert.match(comercio.id, /^o_[a-z0-9]{6}$/);
  assert.equal(q.opciones!.filter((o) => o.id === 'bancos').length, 1); // la segunda «bancos» ya existía: no se repite el id
  const d = aplicarParche(ALONG2, r);
  assert.deepEqual(revisarDefinicion(d), []);
  const cambios = cambiosEnPalabras(ALONG2, d);
  assert.ok(cambios.some((c) => c.includes('agrega «Comercio»')), cambios.join(' | '));
  assert.ok(cambios.some((c) => c.includes('quita «Gobierno»')), cambios.join(' | '));
});

caso('una sección nueva de la IA: ids nuevos y su lógica apunta a ellos', () => {
  const nueva: Seccion = {
    id: 'mascotas', titulo: 'Tus mascotas',
    mostrarSi: { pregunta: 'categorias', incluye: ['mascota'] },
    preguntas: [
      { id: 'nuevo_tipo', tipo: 'multiple', texto: '¿Qué mascotas tienes?', opciones: [{ id: 'perro', label: 'Perro' }, { id: 'gato', label: 'Gato' }] },
      { id: 'nuevo_raza', tipo: 'texto', texto: '¿De qué raza es tu perro?', mostrarSi: { pregunta: 'nuevo_tipo', incluye: ['perro'] } },
    ],
  };
  const r = asentarIds({ secciones: [nueva], orden: [...ALONG2.secciones.map((s) => s.id).slice(0, 4), 'mascotas', ...ALONG2.secciones.map((s) => s.id).slice(4)] }, conocidosDe(ALONG2), ALONG2);
  const s = r.secciones![0];
  assert.match(s.id, /^s_/);
  assert.deepEqual(s.mostrarSi, { pregunta: 'categorias', incluye: ['mascota'] }); // lo que ya existía no se toca
  const [tipo, raza] = s.preguntas;
  assert.match(tipo.id, /^p_/);
  const perro = tipo.opciones!.find((o) => o.label === 'Perro')!;
  assert.deepEqual(raza.mostrarSi, { pregunta: tipo.id, incluye: [perro.id] });
  const d = aplicarParche(ALONG2, r);
  assert.equal(d.secciones[4].id, s.id);
  assert.deepEqual(revisarDefinicion(d), []);
});

caso('una sección que se repite: los bloques y los perfiles siguen a los ids nuevos', () => {
  const prop = {
    secciones: [
      { id: 'bebidas', titulo: 'Bebidas', preguntas: [{ id: 'cuales', tipo: 'multiple' as const, texto: '¿Cuáles tomas?', opciones: [{ id: 'cafe', label: 'Café', corto: 'café' }, { id: 'te', label: 'Té', corto: 'té' }] }] },
      {
        id: 'bloque', titulo: 'Tu {opcion}', repetirPor: 'cuales', repetirSolo: ['cafe', 'te'],
        preguntas: [
          { id: 'frec', tipo: 'unica' as const, texto: '¿Cada cuánto?', opciones: [{ id: 'diario', label: 'Diario' }, { id: 'nunca', label: 'Casi nunca', descarta: 'Casi no lo toma' }] },
          { id: 'solo_cafe', tipo: 'texto' as const, texto: '¿Cómo lo preparas?', mostrarSi: { instanciaEs: ['cafe'] } },
        ],
      },
    ],
    frentes: [{ id: 'cafeteros', nombre: 'Cafeteros', grupo: 'cafe', meta: 6, califica: { todas: [{ bloque: 'bloque', opcion: 'cafe' }, { pregunta: 'frec', instancia: 'cafe', incluye: ['diario'] }] } }],
  };
  const vacia: Definicion = { ...definicionVacia(), secciones: [] };
  const r = asentarIds(prop, conocidosDe(vacia), vacia);
  const [bebidas, bloque] = r.secciones!;
  const cuales = bebidas.preguntas[0];
  const cafe = cuales.opciones!.find((o) => o.label === 'Café')!.id;
  assert.equal(bloque.repetirPor, cuales.id);
  assert.ok(bloque.repetirSolo!.includes(cafe));
  assert.deepEqual(bloque.preguntas[1].mostrarSi, { instanciaEs: [cafe] });
  const diario = bloque.preguntas[0].opciones!.find((o) => o.label === 'Diario')!.id;
  assert.deepEqual(r.frentes![0].califica, { todas: [{ bloque: bloque.id, opcion: cafe }, { pregunta: bloque.preguntas[0].id, instancia: cafe, incluye: [diario] }] });
  assert.match(r.frentes![0].id, /^fr_/);
  const d = aplicarParche(vacia, r);
  assert.deepEqual(revisarDefinicion(d), []);
  const res = evaluar(d, { [cuales.id]: [cafe], [`${bloque.preguntas[0].id}@${cafe}`]: diario, [`${bloque.preguntas[1].id}@${cafe}`]: 'Con leche' });
  assert.deepEqual(res.frentes, [r.frentes![0].id]);
});

caso('la IA no toca el NSE y se avisa lo que una propuesta rompe', () => {
  const nse = pregunta(ALONG2, 'nse_banos');
  const protegida = protegerNse({ preguntas: [{ ...nse, texto: 'Baños' }] }, ALONG2);
  assert.equal(protegida.preguntas![0].texto, nse.texto);
  // Quitar «Aromatizantes» rompe la lógica que la usa.
  const sinAroma = aplicarParche(ALONG2, { preguntas: [{ ...pregunta(ALONG2, 'categorias'), opciones: pregunta(ALONG2, 'categorias').opciones!.filter((o) => o.id !== 'aromatizantes') }] });
  const avisos = avisosDeLogica(ALONG2, sinAroma);
  assert.ok(avisos.some((a) => a.startsWith('Cuándo aparece la sección «Aromatizantes» usa una opción de «¿Cuáles de estos productos')), avisos.join(' | '));
  assert.deepEqual(avisosDeLogica(ALONG2, ALONG2), []);
  // Mover una pregunta de un bloque que se repite a una sección normal cambiaría su columna.
  const aromas = pregunta(ALONG2, 'aromas');
  const movida = aplicarParche(ALONG2, {
    secciones: [
      { ...ALONG2.secciones.find((s) => s.id === 'aroma_bloque')!, preguntas: ALONG2.secciones.find((s) => s.id === 'aroma_bloque')!.preguntas.filter((p) => p.id !== 'aromas') },
      { ...ALONG2.secciones.find((s) => s.id === 'perfil')!, preguntas: [...ALONG2.secciones.find((s) => s.id === 'perfil')!.preguntas, aromas] },
    ],
  });
  assert.ok(columnasQueCambian(ALONG2, movida).some((a) => a.includes('cambiaría su columna')));
  // Quitar una sección y reordenar con el parche.
  const sinRechazo = aplicarParche(ALONG2, { quitarSecciones: ['rechazo'] });
  assert.ok(!sinRechazo.secciones.some((s) => s.id === 'rechazo'));
  assert.ok(cambiosEnPalabras(ALONG2, sinRechazo).includes('Quita la sección «Marcas» y sus 1 pregunta.') || cambiosEnPalabras(ALONG2, sinRechazo).some((c) => c.startsWith('Quita la sección «Marcas»')));
});

caso('los cambios de lógica se cuentan en palabras', () => {
  const d = aplicarParche(ALONG2, {
    preguntas: [{ ...pregunta(ALONG2, 'hogar'), opciones: pregunta(ALONG2, 'hogar').opciones!.map((o) => (o.id === 'roomies' ? { ...o, termina: 'Vive con roomies' } : o)) }],
    frentes: ALONG2.frentes!.map((f) => (f.id === 'reeds' ? { ...f, meta: 8 } : f)),
  });
  const cambios = cambiosEnPalabras(ALONG2, d);
  assert.ok(cambios.includes('En «¿Cómo es tu hogar?»: «Vivo con roomies»: Si contesta esta, no califica: Vive con roomies.'), cambios.join(' | '));
  assert.ok(cambios.includes('La cuota de Reeds pasa de 6 a 8.'), cambios.join(' | '));
  assert.equal(cambios.length, 2);
  const perfil = ALONG2.secciones.find((s) => s.id === 'perfil')!;
  const reordenado = aplicarParche(ALONG2, { secciones: [{ ...perfil, preguntas: [...perfil.preguntas].reverse() }] });
  assert.deepEqual(cambiosEnPalabras(ALONG2, reordenado), ['Cambia el orden de las preguntas de «Sobre ti».']);
  // Cambiar la etiqueta de una opción con lógica no cuenta como regla quitada y agregada.
  const lugar = pregunta(ALONG2, 'lugar');
  const otra = aplicarParche(ALONG2, { preguntas: [{ ...lugar, opciones: lugar.opciones!.map((o) => (o.id === 'otra' ? { ...o, label: 'Otra, ¿cuál?' } : o)) }] });
  assert.deepEqual(cambiosEnPalabras(ALONG2, otra), ['En «¿Dónde lo compras normalmente?» cambia «Otra» por «Otra, ¿cuál?».']);
});

caso('lo que se le pide a la IA lleva lo necesario y el formato que se espera', () => {
  const e = estructuraDeDefinicion(ALONG2);
  const json = definicionParaIA(ALONG2);
  assert.ok(json.includes('"id":"giros"') && json.includes('Regla de NSE: AMAI 2022'));
  assert.ok(!json.includes('"puntos"')); // los puntos del NSE no le sirven a la IA
  JSON.parse(json.slice(0, json.indexOf('\nRegla de NSE')));
  const estudio = { titulo: 'Filtro de prueba', proyecto: 'PRUEBA · Proyecto de prueba', cliente: 'Cliente Prueba' };
  const nuevo = promptEstructura({ origen: 'insumos', estudio });
  assert.match(nuevo, /Propón la estructura/);
  assert.match(nuevo, /no se menciona nunca al participante/);
  assert.match(promptEstructura({ origen: 'word', estudio }), /sin rediseñarlo/);
  const ajuste = promptEstructura({ origen: 'insumos', estudio, base: e, pedido: 'Quita la sección de marcas', ajuste: true });
  assert.ok(ajuste.includes('"cambia": false') && ajuste.includes('Quita la sección de marcas') && ajuste.includes('"id":"aroma_bloque"'));
  assert.match(promptEstructura({ origen: 'filtro', estudio, base: e, pedido: 'Ahora en Monterrey' }), /Se parte de un filtro anterior/);
  const plan = e.secciones.find((s) => s.id === 'aroma_bloque')!;
  const seccion = promptSeccion({ origen: 'insumos', estudio, estructura: e, plan, anterior: ALONG2.secciones.find((s) => s.id === 'aroma_bloque') });
  assert.ok(seccion.includes('id aroma_bloque') && seccion.includes('repetirPor') && seccion.includes('ya estaba escrita'));
  assert.ok(promptSeccion({ origen: 'insumos', estudio, estructura: e, plan: e.secciones.find((s) => s.id === 'aroma_formatos')! }).includes('solo aparece en este caso: «marcó Aromatizantes'));
  assert.ok(promptLogica({ estudio, estructura: e, definicion: ALONG2 }).includes('"frentes"'));
  assert.match(promptCambio({ definicion: ALONG2, alcance: { pregunta: 'giros' }, pedido: 'Agrega comercio' }), /Devuelve esa pregunta completa/);
  assert.match(promptCambio({ definicion: ALONG2, alcance: { seccion: 'compras' }, pedido: 'El orden' }), /"quitarSecciones"/);
});

caso('lo que devuelve la IA se valida antes de usarlo', () => {
  const seccion = ALONG2.secciones.find((s) => s.id === 'aroma_bloque')!;
  assert.ok(RespuestaSeccionZ.safeParse({ seccion, supuestos: [] }).success);
  // La IA a veces manda null en lo opcional: se acepta y se quita.
  const conNull = { seccion: { ...seccion, intro: null, preguntas: seccion.preguntas.map((p) => ({ ...p, ayuda: null, mostrarSi: p.mostrarSi ?? null })) } };
  const r = RespuestaSeccionZ.safeParse(conNull);
  assert.ok(r.success, JSON.stringify(!r.success && r.error.issues.slice(0, 2)));
  const limpia = sinVacios(r.data!.seccion);
  assert.ok(!('intro' in limpia) && !('ayuda' in limpia.preguntas[0]));
  assert.deepEqual(r.data!.supuestos, []);
  assert.ok(!RespuestaSeccionZ.safeParse({ seccion: { ...seccion, preguntas: [{ id: 'x', tipo: 'casillas', texto: 'mal' }] } }).success);
  assert.ok(!RespuestaSeccionZ.safeParse({ seccion: { ...seccion, preguntas: [] } }).success);
  assert.ok(RespuestaLogicaZ.safeParse({ frentes: ALONG2.frentes, alertas: ALONG2.alertas, claves: ALONG2.claves, textos: {} }).success);
  assert.ok(!RespuestaLogicaZ.safeParse({ frentes: [], textos: {} }).success); // sin frentes nadie califica
  assert.ok(EstructuraZ.safeParse(estructuraDeDefinicion(ALONG2)).success);
});

caso('al ajustar un filtro escrito, la lógica final conserva textos, alertas y perfiles que siguen igual', () => {
  const alerta = ALONG2.alertas![0];
  const parche = {
    alertas: [{ ...alerta, texto: 'Otro texto para la misma alerta' }, { texto: 'Alerta nueva', si: { pregunta: 'genero', incluye: ['otro'] } }],
    frentes: ALONG2.frentes!.map((f) => ({ ...f, nombre: f.id === 'reeds' ? 'Varitas' : f.nombre })),
    textos: { bienvenida: 'Otra bienvenida' },
  };
  const r = conservarLogica(parche, ALONG2);
  assert.equal(r.alertas![0].texto, alerta.texto);
  assert.equal(r.alertas![1].texto, 'Alerta nueva');
  assert.equal(r.frentes!.find((f) => f.id === 'reeds')!.nombre, 'Varitas'); // el nombre viene de la estructura
  assert.ok(!('textos' in r));
});

caso('los errores de la cuenta de la IA se dicen en palabras, no como «Error interno»', () => {
  const sinSaldo = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, 'Your credit balance is too low to access the Anthropic API.', new Headers());
  assert.match((errorDeLaIA(sinSaldo) as Error).message, /se quedó sin saldo/);
  assert.match((errorDeLaIA(new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers())) as Error).message, /demasiadas peticiones/);
  assert.match((errorDeLaIA(new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers())) as Error).message, /llave de la IA/);
  assert.match((errorDeLaIA(new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers())) as Error).message, /saturada/);
  assert.match((errorDeLaIA(new Anthropic.APIConnectionError({ message: 'fetch failed' })) as Error).message, /No se pudo conectar/);
  const otro = new Error('otra cosa');
  assert.equal(errorDeLaIA(otro), otro);
});

caso('la skill completa va en el prompt del sistema', () => {
  const sistema = systemPrompt();
  for (const parte of ['references/reglas.md', 'references/redaccion.md', 'references/contrato.md', 'references/estructura.md', 'assets/ejemplos/hogar.json', 'assets/ejemplos/refrescos_cr.md', 'MODO HUB']) {
    assert.ok(sistema.includes(parte), parte);
  }
  // Los ejemplos van sin marcas de clientes: las de la plantilla de ALONG 2 (las que tienen grupo de frentes) no aparecen.
  const marcasDelCliente = pregunta(ALONG2, 'rechazo').opciones!.filter((o) => o.excluyeGrupos).map((o) => o.label);
  assert.equal(marcasDelCliente.length, 2);
  assert.ok(marcasDelCliente.every((m) => !sistema.toLowerCase().includes(m.toLowerCase())));
  assert.ok(sistema.length < 250_000);
});

// ── nombres cortos y columnas del tablero ──
caso('la columna lleva el nombre corto; sin él, el texto; el NSE trae el suyo; el participante no lo ve', () => {
  const cols = columnas(ALONG2, [], { completas: true });
  const titulo = (clave: string) => cols.find((c) => c.clave === clave)?.titulo;
  assert.equal(titulo('edad'), 'Edad');
  assert.equal(titulo('nse_banos'), 'NSE · Baños');
  assert.equal(nombreColumnaTablero(cols.find((c) => c.clave === 'marcas@aerosol')!), 'Tu aerosol · Marcas que compra');
  const sinNombre = structuredClone(ALONG2);
  delete sinNombre.secciones[1].preguntas.find((p) => p.id === 'edad')!.nombre;
  for (const s of sinNombre.secciones) for (const p of s.preguntas) if (p.id.startsWith('nse_')) delete p.nombre;
  const otra = columnas(sinNombre, [], { completas: true });
  assert.equal(otra.find((c) => c.clave === 'edad')?.titulo, '¿Cuántos años tienes?');
  assert.equal(otra.find((c) => c.clave === 'nse_banos')?.titulo, 'NSE · Baños');
  assert.deepEqual(sinNombreCorto(sinNombre).map((p) => p.id), ['edad']);
  assert.ok(!JSON.stringify(definicionPublica(ALONG2)).includes('"nombre":"Edad"'));
});

caso('al ponerle nombre corto, se renombran solas las columnas que dejó el Hub y no las que cambió el equipo', () => {
  const sinNombres = structuredClone(ALONG2);
  for (const s of sinNombres.secciones) for (const p of s.preguntas) delete p.nombre;
  const antes = columnas(sinNombres, [], { completas: true, comoAntes: true });
  const cols = columnas(ALONG2, [], { completas: true });
  const mapa = { edad: 'c1', genero: 'c2', cp: 'c3', 'marcas@aerosol': 'c4', hogar: 'c5', frente: 'c6' };
  const vivas = [
    { id: 'c1', nombre: '¿Cuántos años tienes?' },        // la dejó el Hub (antes de los nombres cortos)
    { id: 'c2', nombre: 'Sexo' },                          // la renombró el equipo
    { id: 'c3', nombre: 'Código postal de tu casa (2)' },  // la dejó el Hub con número
    { id: 'c4', nombre: 'Tu aerosol · ¿Qué marcas de aerosol compras?' },
    { id: 'c5', nombre: 'Tipo de hogar' },                 // ya se llama así
    { id: 'x', nombre: 'Edad' },                           // columna propia del tablero
    { id: 'c6', nombre: 'Filtro · Frente' },               // antes de llamarlos perfiles
  ];
  const r = columnasPorRenombrar({ vivas, mapa, puestos: {}, cols, antes });
  assert.deepEqual(r.map((x) => [x.id, x.nombre]), [['c6', 'Filtro · Perfil'], ['c1', 'Edad (2)'], ['c3', 'Código postal'], ['c4', 'Tu aerosol · Marcas que compra']]);
  // Con los nombres que puso el Hub guardados: si el equipo la cambió después, se respeta.
  const otraVez = columnasPorRenombrar({ vivas: [{ id: 'c1', nombre: 'Edad real' }], mapa, puestos: { edad: 'Edad vieja' }, cols, antes });
  assert.deepEqual(otraVez, []);
  const corregido = columnasPorRenombrar({ vivas: [{ id: 'c1', nombre: 'Edad vieja' }], mapa, puestos: { edad: 'Edad vieja' }, cols, antes });
  assert.deepEqual(corregido.map((x) => x.nombre), ['Edad']);
});

caso('los nombres de la IA: sin signos, sin repetirse (salvo en bloques que se repiten) y todos los pedidos', () => {
  const d = structuredClone(ALONG2);
  for (const s of d.secciones) for (const p of s.preguntas) if (['edad', 'genero', 'marcas', 'marcas_l'].includes(p.id)) delete p.nombre;
  const ids = sinNombreCorto(d).map((p) => p.id);
  assert.deepEqual(ids, ['genero', 'edad', 'marcas', 'marcas_l']);
  const bien = revisarNombres({ genero: '¿Género?', edad: 'Edad', marcas: 'Marcas que compra', marcas_l: 'Marcas que compra', otra: 'X' }, d, ids);
  assert.deepEqual(bien.problemas, []);
  assert.deepEqual(bien.limpios, { genero: 'Género', edad: 'Edad', marcas: 'Marcas que compra', marcas_l: 'Marcas que compra' });
  const mal = revisarNombres({ genero: 'Edad', edad: 'Edad', marcas: 'Marcas' }, d, ids);
  assert.ok(mal.problemas.some((x) => x.includes('se repite')) && mal.problemas.some((x) => x.includes('marcas_l')), mal.problemas.join(' | '));
  const prompt = promptNombres(d, ids);
  assert.ok(prompt.includes('- edad: ¿Cuántos años tienes?') && prompt.includes('ya se llama «Código postal»') && prompt.includes('genero, edad, marcas, marcas_l'));
});

caso('la estructura de un filtro escrito trae los nombres cortos (y no cambian la firma de la sección)', () => {
  const e = estructuraDeDefinicion(ALONG2);
  const perfil = e.secciones.find((s) => s.id === 'perfil')!;
  assert.equal(perfil.preguntas.find((p) => p.id === 'edad')?.nombre, 'Edad');
  const sinNombre = { ...perfil, preguntas: perfil.preguntas.map(({ nombre: _n, ...p }) => p) };
  assert.equal(firmaSeccion(perfil), firmaSeccion(sinNombre));
});

caso('tiempo por perfil: lo que pide el perfil sale seguro; pedir más bloques tarda más', () => {
  const { tipico, maximo } = duracionEstimada(ALONG2);
  const porPerfil = duracionPorPerfil(ALONG2);
  assert.equal(porPerfil.length, ALONG2.frentes!.length);
  for (const p of porPerfil) assert.ok(p.minutos >= tipico - 3 && p.minutos <= maximo, `${p.nombre}: ${p.minutos}`);
  const d = structuredClone(ALONG2);
  const aerosol = d.frentes!.find((f) => f.id === 'aerosol')!;
  d.frentes = [
    { ...aerosol, id: 'uno', nombre: 'Un formato' },
    { ...aerosol, id: 'dos', nombre: 'Dos formatos', califica: { todas: [aerosol.califica, { bloque: 'aroma_bloque', opcion: 'varitas' }, { bloque: 'aroma_bloque', opcion: 'spray' }] } },
  ];
  const [uno, dos] = duracionPorPerfil(d);
  assert.ok(dos.minutos > uno.minutos, `${uno.minutos} vs ${dos.minutos}`);
});

caso('«¿Está listo?» dice qué falta, en palabras', () => {
  const faltan = (o: Parameters<typeof chequeosListo>[0]) => chequeosListo(o).filter((c) => !c.ok).map((c) => c.id);
  assert.deepEqual(faltan({ def: ALONG2, problemas: 0, respuestasDePrueba: 2, vinculado: true }), []);
  const sinPerfiles = { ...structuredClone(ALONG2), frentes: [] };
  delete sinPerfiles.secciones[1].preguntas[0].nombre;
  const r = chequeosListo({ def: sinPerfiles, problemas: 2, supuestosPorRevisar: 3, respuestasDePrueba: 0, vinculado: false });
  assert.deepEqual(r.filter((c) => !c.ok).map((c) => c.id), ['problemas', 'perfiles', 'nombres', 'supuestos', 'probado', 'tablero']);
  assert.equal(r.find((c) => c.id === 'problemas')?.falta, '2 cosas por corregir');
  assert.equal(r.find((c) => c.id === 'nombres')?.falta, '1 pregunta sin nombre');
});

caso('celular con la lada y el largo del país', () => {
  const mx = telefonoDe('MX');
  assert.equal(limpiarTelefono('+52 55 0000 0000', mx), '5500000000');
  assert.equal(limpiarTelefono('55-0000-00009999', mx), '5500000000');
  assert.equal(agruparTelefono('5500000000', mx), '55 0000 0000');
  assert.equal(agruparTelefono('550', mx), '55 0');
  const cr = telefonoDe('CR');
  assert.equal(cr.lada, '+506');
  assert.equal(agruparTelefono(limpiarTelefono('+506 8000 0000', cr), cr), '8000 0000');
  const def: Definicion = { ...definicionVacia('CR'), secciones: [{ id: 's', preguntas: [{ id: 'cel', tipo: 'telefono', texto: 'Celular' }] }] };
  const [pantalla] = pantallas(def, {});
  assert.deepEqual(validarPantalla(pantalla, { cel: '80000000' }, 'CR'), {});
  assert.equal(validarPantalla(pantalla, { cel: '5500000000' }, 'CR').cel, 'Escribe un celular de 8 dígitos');
});

caso('el correo mal escrito trae sugerencia; uno de empresa, no', () => {
  assert.equal(sugerirCorreo('persona@gmial.com'), 'persona@gmail.com');
  assert.equal(sugerirCorreo('persona@hotmail'), 'persona@hotmail.com');
  assert.equal(sugerirCorreo('persona@gmail.com'), undefined);
  assert.equal(sugerirCorreo('persona@ejemplo.test'), undefined);
});

caso('el catálogo de códigos postales se lee con los nombres de estado del Hub', () => {
  const texto = [
    'El Catálogo Nacional de Códigos Postales… (nota)',
    'd_codigo|d_asenta|d_tipo_asenta|D_mnpio|d_estado|d_ciudad|d_CP|c_estado|c_oficina|c_CP|c_tipo_asenta|c_mnpio|id_asenta_cpcons|d_zona|c_cve_ciudad',
    '01000|Colonia Uno|Colonia|Municipio Prueba|Ciudad de México|Ciudad de México|01001|09|01001||09|010|0001|Urbano|01',
    '50000|Barrio Dos|Barrio|Toluca|México|Toluca de Lerdo|50001|15|50001||02|106|0002|Urbano|01',
    '91000|Fracc. Tres|Fraccionamiento|Xalapa|Veracruz de Ignacio de la Llave|Xalapa|91001|30|91001||21|087|0003|Urbano|01',
    '',
  ].join('\n');
  const { filas, estadosDesconocidos } = leerCatalogoSepomex(texto);
  assert.deepEqual(filas.map((f) => [f.cp, f.colonia, f.municipio, f.estado]), [
    ['01000', 'Colonia Uno', 'Municipio Prueba', 'Ciudad de México'],
    ['50000', 'Barrio Dos', 'Toluca', 'Estado de México'],
    ['91000', 'Fracc. Tres', 'Xalapa', 'Veracruz'],
  ]);
  assert.deepEqual(estadosDesconocidos, []);
  assert.throws(() => leerCatalogoSepomex('otra cosa'), /encabezados/);
});

caso('la dirección de Google cae en los campos del Hub, por tipo y con el nombre de estado del Hub', () => {
  const comp = (longText: string, types: string[], shortText = longText) => ({ longText, shortText, types });
  const d = direccionDeComponentes([
    comp('México', ['country', 'political'], 'MX'),
    comp('01000', ['postal_code']),
    comp('Estado de México', ['administrative_area_level_1', 'political'], 'Méx.'),
    comp('Municipio Prueba', ['locality', 'political']),
    comp('Colonia Prueba', ['sublocality_level_1', 'sublocality', 'political']),
    comp('Calle Inventada', ['route']),
    comp('123', ['street_number']),
  ], 'MX');
  assert.deepEqual(d, { calle: 'Calle Inventada', numero: '123', colonia: 'Colonia Prueba', ciudad: 'Municipio Prueba', estado: 'Estado de México', cp: '01000' });
  const cdmx = direccionDeComponentes([comp('Ciudad de México', ['locality']), comp('CDMX', ['administrative_area_level_1'])], 'MX');
  assert.equal(cdmx.estado, 'Ciudad de México');
  assert.equal(cdmx.ciudad, ''); // Google no da la alcaldía: la escriben
  assert.equal(direccionDeComponentes([comp('Ver.', ['administrative_area_level_1'], 'Ver.')], 'MX').estado, 'Veracruz');
  assert.equal(direccionDeComponentes([comp('Provincia Inventada', ['administrative_area_level_1'])], 'CR').estado, 'Provincia Inventada');
});

caso('las imágenes que faltan salen en «¿Está listo?»; «Ninguno» no lleva imagen', () => {
  const sinUna = cambiarOpcion(PRUEBA_TIPOS, 'empaque', 'lata', { imagen: undefined });
  const faltan = imagenesQueFaltan(sinUna);
  assert.deepEqual(faltan.map((x) => [x.pregunta.id, x.faltan]), [['empaque', 1]]);
  const r = chequeosListo({ def: sinUna, problemas: 0, respuestasDePrueba: 1, vinculado: true }).find((c) => c.id === 'imagenes')!;
  assert.equal(r.ok, false);
  assert.match(r.falta ?? '', /empaque|Qué empaque/i);
  assert.equal(chequeosListo({ def: PRUEBA_TIPOS, problemas: 0, respuestasDePrueba: 1, vinculado: true }).find((c) => c.id === 'imagenes')?.ok, true);
  assert.equal(chequeosListo({ def: ALONG2, problemas: 0, respuestasDePrueba: 1, vinculado: true }).some((c) => c.id === 'imagenes'), false);
});

caso('el flujo de una estructura (antes de escribir) sale con las mismas ramas que el filtro escrito', () => {
  const vista = (filas: ReturnType<typeof filasFlujo>) => filas.map((f) => (f.tipo === 'paso' ? f.bloque.id : f.ramas.map((r) => r.map((b) => b.id).join('>')).join('|')));
  const e = estructuraDeDefinicion(ALONG2);
  assert.deepEqual(e.secciones.find((s) => s.id === 'aroma_formatos')?.segun, ['categorias']);
  assert.deepEqual(vista(filasFlujoDeEstructura(e)), vista(filasFlujo(ALONG2)));
  // Sin «segun» (una propuesta vieja), cada sección que aparece si aplica abre su rama; lo que se repite sigue a su pregunta.
  const sinSegun = { ...e, secciones: e.secciones.map(({ segun: _s, ...s }) => s) };
  const ramas = filasFlujoDeEstructura(sinSegun).find((f) => f.tipo === 'ramas');
  assert.ok(ramas && ramas.tipo === 'ramas' && ramas.ramas[0].map((b) => b.id).join('>') === 'aroma_formatos>aroma_bloque');
  const filtros = filasFlujoDeEstructura(e).find((f) => f.tipo === 'paso' && f.bloque.id === 'filtros');
  assert.ok(filtros && filtros.tipo === 'paso' && filtros.bloque.termina.length > 0);
});

caso('todo filtro arranca con «Antes de empezar»: aviso, nombre, celular, correo e identificación', () => {
  const d = conInicio(ALONG2);
  assert.equal(d.secciones[0].id, SECCION_INICIO);
  assert.equal(d.secciones.flatMap((x) => x.preguntas).filter((p) => p.id === 'aviso' || p.id === 'nombre').length, 0);
  assert.equal(d.claves?.nombre, 'hub_nombre');
  assert.deepEqual(revisarDefinicion(d), []);
  assert.equal(conInicio(d), d); // no se pone dos veces
  // La plantilla que ya tenía su «Antes de empezar» (con indicaciones) no queda con dos secciones con el mismo nombre.
  const prueba = conInicio(PRUEBA_TIPOS);
  assert.deepEqual(prueba.secciones.slice(0, 2).map((x) => x.titulo), ['Antes de empezar', 'Indicaciones']);
  assert.deepEqual(revisarDefinicion(prueba), []);
  // «No acepto» termina sin pedir lo demás; aceptar pide nombre y si da la identificación; «No» termina; con «Sí», la foto.
  const [inicio] = pantallas(d, {});
  assert.deepEqual(inicio.preguntas.map((p) => p.clave), ['hub_aviso']);
  assert.equal(evaluar(d, { hub_aviso: 'no_acepto' }).terminado?.motivo, 'No aceptó el aviso de privacidad');
  assert.equal(evaluar(d, { hub_aviso: 'acepto', hub_nombre: 'Persona de Prueba', hub_id_acepta: 'no' }).terminado?.motivo, 'No quiso dar su identificación');
  // ALONG 2 ya pide su celular: solo se agrega el correo, y el celular del panel sigue siendo el suyo.
  assert.deepEqual(pantallas(d, { hub_aviso: 'acepto' })[0].preguntas.map((p) => p.clave), ['hub_aviso', 'hub_nombre', 'contacto_correo', 'hub_id_acepta']);
  assert.deepEqual(pantallas(d, { hub_aviso: 'acepto', hub_id_acepta: 'si' })[0].preguntas.map((p) => p.clave), ['hub_aviso', 'hub_nombre', 'contacto_correo', 'hub_id_acepta', 'hub_id_foto']);
  assert.equal(d.claves?.telefono, ALONG2.claves?.telefono);
  // Un filtro que no los pide: los dos, y el celular es el del panel.
  const vacio = conInicio(definicionVacia());
  assert.deepEqual(vacio.secciones[0].preguntas.map((p) => p.id), ['hub_aviso', 'hub_nombre', 'contacto_celular', 'contacto_correo', 'hub_id_acepta', 'hub_id_foto']);
  assert.equal(vacio.claves?.telefono, 'contacto_celular');
  // El analista los puede quitar (no son fijos ni cortan), y el filtro sigue sin problemas.
  assert.ok(!esFija(vacio, 'contacto_celular') && !esFija(vacio, 'contacto_correo'));
  const sinCelular = quitarPregunta(vacio, 'contacto_celular');
  assert.equal(sinCelular.claves?.telefono, undefined);
  assert.equal(sinCelular.claves?.nombre, 'hub_nombre');
  assert.deepEqual(revisarDefinicion(sinCelular), []);
  // Al escribir con la IA, lo que llega va después de «Antes de empezar», y la IA no lo puede quitar.
  const e = estructuraDeDefinicion(d);
  assert.ok(!e.secciones.some((x) => x.id === SECCION_INICIO));
  const puesta = ponerSeccion(conInicio(definicionVacia()), d.secciones[1], e);
  assert.equal(puesta.secciones[0].id, SECCION_INICIO);
  const protegido = protegerNse({ quitarSecciones: [SECCION_INICIO], orden: [d.secciones[1].id, SECCION_INICIO] }, d);
  assert.deepEqual(protegido.quitarSecciones, []);
  assert.equal(protegido.orden?.[0], SECCION_INICIO);
});

caso('el celular junto al documento muestra cualquier sección sin contestar lo de antes', () => {
  // Las preguntas que solo salen si aplica también se ven; las opciones que salen de otra pregunta, todas las de esa.
  const formatos = pantallaDeMuestra(ALONG2, 'aroma_formatos')!;
  assert.deepEqual(formatos.preguntas.map((p) => p.clave), ['formatos_uso', 'formatos_compra']);
  assert.equal(formatos.preguntas[1].opciones.length, 13); // 12 formatos (sin «Ninguno de estos») + «Ninguno en los últimos 3 meses»
  // Un bloque que se repite se ve con su primera repetición.
  const bloque = pantallaDeMuestra(ALONG2, 'aroma_bloque')!;
  assert.equal(bloque.titulo, 'Tu aerosol');
  assert.equal(bloque.preguntas.find((p) => p.pregunta.id === 'favorita')!.opciones.length, 8);
  assert.equal(pantallaDeMuestra(ALONG2, 'no_existe'), undefined);
  // Con lo contestado, la pantalla real es la misma.
  const real = pantallas(ALONG2, { categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], marcas: ['airwick', 'glade', 'wiese', 'febreze', 'bbw', 'lumerra', 'propia', 'otra'] } as never).find((x) => x.seccion.id === 'aroma_bloque');
  assert.equal(real?.titulo, bloque.titulo);
});

caso('el Word y el PDF del cliente salen con el formato de los filtros del equipo', async () => {
  const d = conInicio(ALONG2);
  const bloques = documentoDeFiltro(d, 'Estudio de prueba');
  const texto = textoDeBloques(bloques);
  // La portada con su ficha, la muestra con sus perfiles y las preguntas numeradas de corrido.
  assert.ok(texto.startsWith('Estudio de prueba\nPaís: México\nDuración aproximada: '), texto.slice(0, 80));
  assert.ok(texto.includes('Muestra\nPERFIL 1: Aerosoles / Pure · 6 · Tiene el bloque'));
  const numeros = bloques.filter((b) => b.tipo === 'pregunta').map((b) => (b as { numero: number }).numero);
  assert.deepEqual(numeros, numeros.map((_, i) => i + 1));
  // Cada opción con CONTINUAR o TERMINAR; lo que solo descarta el bloque, dicho aparte.
  assert.ok(texto.includes('2 No acepto TERMINAR'));
  assert.ok(texto.includes('Lumerra TERMINAR'));
  assert.ok(texto.includes('Menos de 3 meses NO CUENTA ESTE BLOQUE'));
  assert.ok(texto.includes('Si contesta menos de 25 o más de 65, TERMINAR'));
  // En las secciones que se repiten, [OPCIÓN] en vez de {opcion}; nada de ids ni marcadores sueltos.
  assert.ok(texto.includes('¿Qué marcas de [OPCIÓN] compras?'));
  assert.ok(!texto.includes('{opcion}') && !texto.includes('hub_'));
  assert.ok(bloques.some((b) => b.tipo === 'pregunta' && !!b.matriz));
  assert.equal(nombreDocumento('PRUEBA: AI / 2', 'docx'), 'PRUEBA AI 2 - Filtro de reclutamiento.docx');
  // El Word es un .docx con el documento adentro.
  const zip = await JSZip.loadAsync(await wordDeDocumento(bloques, 'Estudio de prueba · Filtro de reclutamiento'));
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.ok(xml.includes('Filtro de reclutamiento') && xml.includes('TERMINAR') && xml.includes('rIdEncabezado'));
  assert.ok(zip.file('word/media/logo.emf'), 'el encabezado de Sapience lleva su logo');
});

caso('negritas y color: se leen, se ponen y se quitan, y no llegan a las columnas', async () => {
  assert.deepEqual(leerFormato('¿Compraste **en los últimos 3 meses**?'), [{ texto: '¿Compraste ' }, { texto: 'en los últimos 3 meses', negrita: true }, { texto: '?' }]);
  assert.deepEqual(leerFormato('**NO** ==leer== **a ==b== c**'), [
    { texto: 'NO', negrita: true }, { texto: ' ' }, { texto: 'leer', resaltado: true }, { texto: ' ' },
    { texto: 'a ', negrita: true }, { texto: 'b', negrita: true, resaltado: true }, { texto: ' c', negrita: true },
  ]);
  // Una marca sola o vacía se lee como texto.
  assert.equal(sinFormato('2 ** 3 = 6 ** 1 y ****'), '2 ** 3 = 6 ** 1 y ****');
  assert.equal(sinFormato('a == b'), 'a == b');
  assert.equal(sinFormato('**NO** compro ==nunca=='), 'NO compro nunca');
  // Con el cursor en una palabra la marca entera; otra vez la quita; los espacios quedan fuera.
  const r = alternarMarca('Compras NO cada mes', 9, 9, 'negrita');
  assert.deepEqual(r, { valor: 'Compras **NO** cada mes', inicio: 10, fin: 12 });
  assert.equal(alternarMarca(r.valor, r.inicio, r.fin, 'negrita').valor, 'Compras NO cada mes');
  assert.equal(alternarMarca('Compras NO cada mes', 7, 11, 'resaltado').valor, 'Compras ==NO== cada mes');
  assert.equal(alternarMarca('a **NO** b', 2, 8, 'negrita').valor, 'a NO b');

  const d = conInicio(ALONG2);
  const edad = d.secciones.flatMap((x) => x.preguntas).find((x) => x.id === 'edad')!;
  const conFormato: Definicion = {
    ...d,
    bienvenida: 'Gracias por **tu tiempo**.',
    secciones: d.secciones.map((x) => ({ ...x, preguntas: x.preguntas.map((q) => (q.id === 'edad' ? { ...q, texto: '¿Cuántos **años** ==cumplidos== tienes?', nombre: undefined, ayuda: 'Solo **el número**' } : q)) })),
  };
  // La columna del tablero y el Excel, sin marcas.
  const col = columnas(conFormato, [], { completas: true }).find((c) => c.clave === 'edad');
  assert.equal(col?.titulo, '¿Cuántos años cumplidos tienes?');
  assert.ok(edad);
  // En el Word: dentro de la pregunta (ya en negritas) lo marcado se subraya; el color, morado.
  assert.deepEqual(tramosDe('Hola **tú**', { negrita: true }), [{ negrita: true, texto: 'Hola ' }, { negrita: true, texto: 'tú', subrayado: true }]);
  const bloques = documentoDeFiltro(conFormato, 'Estudio de prueba');
  assert.ok(textoDeBloques(bloques).includes('. ¿Cuántos años cumplidos tienes?\nSolo el número'));
  const xml = await (await JSZip.loadAsync(await wordDeDocumento(bloques, 'Prueba'))).file('word/document.xml')!.async('string');
  assert.match(xml, /<w:u w:val="single"\/>.*?<w:t xml:space="preserve">años<\/w:t>/);
  assert.match(xml, /<w:color w:val="7030A0"\/>.*?<w:t xml:space="preserve">cumplidos<\/w:t>/);
  assert.ok(!xml.includes('**') && !xml.includes('=='));
});

caso('la identificación se compara con lo declarado: nombre, edad y lugar; lo que no cuadra es alerta', () => {
  const hoy = new Date('2026-10-23T12:00:00');
  assert.equal(edadDe('1990-11-30', hoy), 35);
  assert.equal(edadDe('1990-10-23', hoy), 36);
  const leido = { esIdentificacion: true, legible: true, tipo: 'INE', nombre: 'PERSONA DE PRUEBA EJEMPLO', fechaNacimiento: '1990-11-30', ciudad: 'Municipio Prueba', estado: 'Méx.' };
  const bien = compararIdentificacion(leido, { nombre: 'Persona Ejemplo', edad: 35, estado: 'Estado de México' }, 'MX', hoy);
  assert.deepEqual(bien.alertas, []);
  assert.equal(bien.edad, 35);
  const mal = compararIdentificacion(leido, { nombre: 'Otra Persona Distinta', edad: 25, estado: 'Jalisco' }, 'MX', hoy);
  assert.deepEqual(mal.alertas, [
    'La identificación dice otro nombre: «PERSONA DE PRUEBA EJEMPLO»',
    'Edad distinta en la identificación: 35 años',
    'La identificación es de otro lugar: Municipio Prueba, Méx.',
  ]);
  assert.deepEqual(compararIdentificacion({ ...leido, esIdentificacion: false }, {}, 'MX', hoy).alertas, ['La foto no parece una identificación oficial']);
  // Si tapó la dirección, no se compara el lugar.
  assert.deepEqual(compararIdentificacion({ ...leido, ciudad: null, estado: null }, { nombre: 'Persona Ejemplo', estado: 'Jalisco' }, 'MX', hoy).alertas, []);
  const d = conInicio(ALONG2);
  assert.deepEqual(declaradoDe(d, { hub_nombre: 'Persona Ejemplo', edad: 35 }), { nombre: 'Persona Ejemplo', edad: 35, ciudad: undefined, estado: undefined });
});

await Promise.all(pendientes);
console.log(`\n${pasaron} pruebas pasaron`);
