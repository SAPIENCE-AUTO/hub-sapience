// Pruebas del motor de Tools → Formularios con las plantillas (ALONG 2 y la de todos los tipos) y respuestas
// inventadas. No toca la base. Uso: cd server && npx tsx scripts/test-formularios.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { evaluar, pantallas, definicionPublica, validarPantalla, describir, type Pantalla } from '../../src/lib/formularios/motor';
import { columnas, type FilaRespuesta } from '../../src/lib/formularios/tabla';
import { construirExcel } from '../../src/lib/formularios/excel';
import { revisarDefinicion } from '../../src/lib/formularios/revisar';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import { ALONG2 } from '../../src/lib/formularios/plantillas/along2';
import { PRUEBA_TIPOS } from '../../src/lib/formularios/plantillas/pruebaTipos';
import { leerDefinicion, type Definicion, type Respuestas } from '../../src/lib/formularios/tipos';
import { calcularNse, reglaNse, reglaVigente } from '../../src/lib/formularios/nse';

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
  assert.match(problemas, /«b».*ninguna opción tiene imagen/);
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
caso('NSE C en un frente que pide C+: entra con alerta, no la saca', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_C, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.equal(r.nse?.nivel, 'C');
  assert.deepEqual(r.frentes, ['aerosol']);
  assert.equal(r.califica, true);
  assert.deepEqual(r.nse?.fueraDe, ['aerosol']);
  assert.ok(r.alertas.includes('NSE C, el frente Aerosoles / Pure pide C+'), r.alertas.join(' | '));
});

caso('NSE que sí coincide: sin alerta', () => {
  const r = evaluar(ALONG2, { ...base, ...NSE_CMAS, categorias: ['aromatizantes'], formatos_uso: ['aerosol'], formatos_compra: ['aerosol'], ...bloqueAerosol });
  assert.equal(r.nse?.fueraDe, undefined);
  assert.deepEqual(r.alertas, []);
});

caso('en un frente con dos caminos, la alerta dice el NSE del camino por el que entró', () => {
  const brasso = {
    ...base, edad: 50, categorias: ['limpiadores'], tipos: ['todo_proposito'],
    'marcas_l@todo_proposito': ['fabuloso'], 'favorita_l@todo_proposito': 'fabuloso', 'variante@todo_proposito': 'Lavanda',
    'presentacion@todo_proposito': ['diluir'], 'tamano@todo_proposito': 'galon', 'lugar_l@todo_proposito': ['aurrera'],
    'ultima_l@todo_proposito': '2a4sem', 'diluye@todo_proposito': 'cubeta', foto_limpiadores: [{ ruta: 'x', nombre: 'x' }],
  };
  const r = evaluar(ALONG2, { ...brasso, ...NSE_CMAS });
  assert.deepEqual(r.frentes, ['brasso']);
  assert.ok(r.alertas.includes('NSE C+, el frente Brasso / limpiadores pide C, C- o D+'), r.alertas.join(' | '));
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

caso('con todos los tipos contestados califica en su frente', () => {
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
  assert.match(evaluar(PRUEBA_TIPOS, { ...tipos, tienda: 'nadie' }).terminado?.motivo ?? '', /No hace compras/);
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

caso('NSE en la plantilla de prueba: C en el frente de lata da alerta', () => {
  const r = evaluar(PRUEBA_TIPOS, { ...tipos, ...NSE_C });
  assert.deepEqual(r.frentes, ['lata']);
  assert.equal(r.califica, true);
  assert.deepEqual(r.alertas, ['NSE C, el frente Prefiere lata pide A/B o C+']);
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
    assert.equal(celda(7, /Dónde usas.*Aromatizante/), 'Casa, Auto');
    assert.equal(celda(7, /te gusta/), 4);
    assert.equal(celda(8, /^Alertas$/), 'NSE C, el frente Prefiere lata pide A/B o C+');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await Promise.all(pendientes);
console.log(`\n${pasaron} pruebas pasaron`);
