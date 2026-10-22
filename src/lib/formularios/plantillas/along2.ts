import type { Definicion, Opcion } from '../tipos';

/**
 * Screener ALONG 2 · Consumer Closeness 2026 (Vestacy), versión 4 del Word
 * («ALONG 2 - Screener v4.docx» en OneDrive). Primer ensayo de Tools →
 * Formularios: se carga en modo prueba, nunca con datos reales en el código.
 */

const SI_NO_TIENDAS: Opcion[] = [
  { id: 'walmart', label: 'Walmart' },
  { id: 'aurrera', label: 'Bodega Aurrera' },
  { id: 'soriana', label: 'Soriana' },
  { id: 'chedraui', label: 'Chedraui' },
  { id: 'lacomer', label: 'La Comer / City Market' },
  { id: 'heb', label: 'HEB' },
  { id: 'costco', label: 'Costco' },
  { id: 'sams', label: 'Sam’s Club' },
  { id: 'conveniencia', label: 'OXXO u otra tienda de conveniencia' },
  { id: 'farmacia', label: 'Farmacia' },
  { id: 'departamental', label: 'Tienda departamental (Liverpool, Palacio, Sears)' },
  { id: 'decoracion', label: 'Tienda de decoración o de velas' },
  { id: 'enlinea', label: 'Amazon o Mercado Libre' },
  { id: 'esquina', label: 'Tienda de la esquina o mercado' },
  { id: 'otra', label: 'Otra', otra: true, fija: true },
];

const ULTIMA_COMPRA = (descarta: string): Opcion[] => [
  { id: 'semana', label: 'Esta semana' },
  { id: '2a4sem', label: 'Hace 2 a 4 semanas' },
  { id: '1a3m', label: 'Hace 1 a 3 meses' },
  { id: 'mas3m', label: 'Hace más de 3 meses', descarta },
];

export const ALONG2: Definicion = {
  version: 1,
  tituloPublico: 'Estudio sobre productos para el hogar',
  bienvenida: '¡Hola! En Sapience hacemos estudios sobre los productos que la gente compra para su casa. Contestar toma unos 10 minutos y te pediremos un par de fotos desde tu celular. Tus respuestas son confidenciales y solo se usan para investigación.',
  despedida: '¡Gracias! Revisaremos tus respuestas y, si tu perfil coincide con lo que buscamos, te escribiremos por WhatsApp.',
  noCalifica: '¡Gracias por tu tiempo! Por ahora tu perfil no coincide con lo que buscamos para este estudio.',
  claves: { nombre: 'nombre', telefono: 'celular', edad: 'edad', genero: 'genero' },

  secciones: [
    {
      id: 'aviso',
      titulo: 'Antes de empezar',
      preguntas: [{
        id: 'aviso', tipo: 'unica', texto: '¿Leíste y aceptas el aviso de privacidad de Sapience?',
        ayuda: 'Tus datos solo se usan para invitarte a estudios. Puedes pedir que los borremos cuando quieras.',
        opciones: [{ id: 'si', label: 'Sí, acepto' }, { id: 'no', label: 'No acepto', termina: 'No aceptó el aviso de privacidad' }],
      }],
    },
    {
      id: 'perfil',
      titulo: 'Sobre ti',
      preguntas: [
        { id: 'nombre', tipo: 'texto', texto: 'Nombre completo' },
        { id: 'celular', tipo: 'telefono', texto: 'Celular (WhatsApp)' },
        {
          id: 'genero', tipo: 'unica', texto: 'Eres…',
          opciones: [{ id: 'mujer', label: 'Mujer' }, { id: 'hombre', label: 'Hombre' }, { id: 'otro', label: 'Otro / prefiero no decir' }],
        },
        {
          id: 'edad', tipo: 'numero', texto: '¿Cuántos años tienes?', min: 15, max: 99,
          terminaFuera: { min: 25, max: 65, motivo: 'Edad fuera de 25 a 65' },
          nota: '41 a 44 solo entra a Air Wick; 56 a 65 solo a Brasso (lo resuelven los frentes).',
        },
        { id: 'cp', tipo: 'texto', texto: 'Código postal de tu casa', patron: '^\\d{5}$', patronMensaje: 'Escribe los 5 dígitos', nota: 'Zona de campo por definir con operación.' },
        {
          id: 'hogar', tipo: 'unica', texto: '¿Cómo es tu hogar?',
          opciones: [
            { id: 'pareja_hijos', label: 'Pareja con hijos' },
            { id: 'extensa', label: 'Familia extensa (con abuelos, tíos o primos)' },
            { id: 'monoparental', label: 'Mamá o papá solo/a con sus hijos' },
            { id: 'pareja', label: 'Pareja sin hijos' },
            { id: 'solo', label: 'Vivo solo/a' },
            { id: 'roomies', label: 'Vivo con roomies' },
          ],
          nota: 'Variedad de hogares en cada frente; solo/a o con roomies, máximo 1 por frente.',
        },
      ],
    },
    {
      id: 'filtros',
      titulo: 'Algunas preguntas rápidas',
      preguntas: [
        {
          id: 'giros', tipo: 'multiple', texto: '¿Tú o alguien de tu familia o amigos cercanos trabaja en alguno de estos giros?',
          opciones: [
            { id: 'bancos', label: 'Bancos o seguros' },
            { id: 'publicidad', label: 'Publicidad o marketing', termina: 'Trabaja en publicidad o marketing' },
            { id: 'educacion', label: 'Educación o salud' },
            { id: 'investigacion', label: 'Investigación de mercados', termina: 'Trabaja en investigación de mercados' },
            { id: 'medios', label: 'Medios de comunicación', termina: 'Trabaja en medios' },
            { id: 'categoria', label: 'Fabricación o venta de productos de limpieza, aromatizantes o cuidado personal', termina: 'Trabaja en la categoría' },
            { id: 'alimentos', label: 'Alimentos y bebidas' },
            { id: 'gobierno', label: 'Gobierno' },
            { id: 'ninguno', label: 'Ninguno de estos', exclusiva: true },
          ],
        },
        {
          id: 'estudio_previo', tipo: 'multiple', texto: '¿Has participado en un estudio de mercado en los últimos 6 meses? ¿De qué tema?',
          opciones: [
            { id: 'no', label: 'No he participado', exclusiva: true },
            { id: 'alimentos', label: 'Sí, de alimentos o bebidas' },
            { id: 'bancos', label: 'Sí, de bancos o tarjetas' },
            { id: 'personal', label: 'Sí, de cuidado personal' },
            { id: 'limpieza', label: 'Sí, de productos de limpieza', termina: 'Estudio reciente de limpieza' },
            { id: 'aromatizantes', label: 'Sí, de aromatizantes', termina: 'Estudio reciente de aromatizantes' },
            { id: 'otro', label: 'Sí, de otro tema' },
          ],
        },
      ],
    },
    {
      id: 'compras',
      titulo: 'Lo que compras para tu casa',
      preguntas: [
        {
          id: 'categorias', tipo: 'multiple', texto: '¿Cuáles de estos productos compras tú para tu casa?', aleatorio: true,
          opciones: [
            { id: 'shampoo', label: 'Shampoo y jabón' },
            { id: 'botanas', label: 'Botanas y galletas' },
            { id: 'aromatizantes', label: 'Aromatizantes para la casa o el auto' },
            { id: 'refrescos', label: 'Refrescos y jugos' },
            { id: 'detergente', label: 'Detergente para ropa' },
            { id: 'limpiadores', label: 'Limpiadores para la casa' },
            { id: 'mascota', label: 'Alimento para mascota' },
            { id: 'cafe', label: 'Café' },
            { id: 'ninguno', label: 'Ninguno de estos', exclusiva: true, fija: true },
          ],
          terminaSi: { si: { pregunta: 'categorias', noIncluye: ['aromatizantes', 'limpiadores'] }, motivo: 'No compra aromatizantes ni limpiadores' },
          nota: 'Las demás categorías solo disimulan.',
        },
        {
          id: 'rol', tipo: 'matriz', texto: 'En tu casa, ¿quién se encarga de cada cosa?',
          filas: [
            { id: 'super', label: 'Hacer el súper' },
            { id: 'cocinar', label: 'Cocinar' },
            { id: 'limpiar', label: 'Limpiar la casa' },
            { id: 'aromatizar', label: 'Que la casa huela bien' },
            { id: 'ropa', label: 'Lavar la ropa' },
          ],
          opciones: [{ id: 'yo', label: 'Yo' }, { id: 'compartido', label: 'Yo y alguien más' }, { id: 'otra', label: 'Otra persona' }],
          reglasMatriz: [
            { fila: 'aromatizar', columnas: ['otra'], excluyeGrupos: ['airwick'] },
            { fila: 'limpiar', columnas: ['otra'], excluyeGrupos: ['brasso'] },
          ],
        },
      ],
    },

    // ── aromatizantes ──
    {
      id: 'aroma_formatos',
      titulo: 'Aromatizantes',
      mostrarSi: { pregunta: 'categorias', incluye: ['aromatizantes'] },
      preguntas: [
        {
          id: 'formatos_uso', tipo: 'multiple', texto: '¿Cuáles de estos aromatizantes usas en tu casa o en tu auto?', aleatorio: true,
          opciones: [
            { id: 'aerosol', label: 'Aerosol (lata que rocías)', corto: 'aerosol' },
            { id: 'spray', label: 'Spray para ambiente y telas, sin gas', corto: 'spray sin gas' },
            { id: 'varitas', label: 'Difusor de varitas', corto: 'difusor de varitas' },
            { id: 'gotas', label: 'Aromatizante concentrado en gotas', corto: 'aromatizante en gotas' },
            { id: 'esfera', label: 'Adorno o esfera aromática', corto: 'adorno o esfera aromática' },
            { id: 'electrico', label: 'Aromatizante que se conecta a la luz', corto: 'aromatizante eléctrico' },
            { id: 'automatico', label: 'Aerosol automático (aparato que rocía solo)', corto: 'aerosol automático' },
            { id: 'velas', label: 'Velas aromáticas', corto: 'vela aromática' },
            { id: 'gel', label: 'Gel, perlas o pastillas aromáticas', corto: 'gel aromático' },
            { id: 'incienso', label: 'Incienso', corto: 'incienso' },
            { id: 'aceites', label: 'Difusor de aceites esenciales con agua', corto: 'difusor de aceites' },
            { id: 'auto', label: 'Aromatizante para auto', corto: 'aromatizante para auto' },
            { id: 'ninguno', label: 'Ninguno de estos', exclusiva: true, fija: true },
          ],
        },
        {
          id: 'formatos_compra', tipo: 'multiple', texto: '¿Y cuáles compraste en los últimos 3 meses?',
          opcionesDe: 'formatos_uso',
          opcionesExtra: [{ id: 'ninguno', label: 'Ninguno en los últimos 3 meses', exclusiva: true }],
          mostrarSi: { pregunta: 'formatos_uso', noIncluye: ['ninguno'] },
          nota: 'Cada formato marcado aquí abre su bloque.',
        },
      ],
    },
    {
      id: 'aroma_bloque',
      titulo: 'Tu {opcion}',
      repetirPor: 'formatos_compra',
      preguntas: [
        { id: 'aromas', tipo: 'texto', texto: '¿Qué aroma o aromas de {opcion} compras? Escríbelos como vienen en el empaque', nota: '«No sé», «el normal» o «varios» sin nombrarlos: descartar a mano en la revisión.' },
        {
          id: 'marcas', tipo: 'multiple', texto: '¿Qué marcas de {opcion} compras?', aleatorio: true,
          opciones: [
            { id: 'airwick', label: 'Air Wick' },
            { id: 'glade', label: 'Glade' },
            { id: 'wiese', label: 'Wiese' },
            { id: 'febreze', label: 'Febreze' },
            { id: 'bbw', label: 'Bath & Body Works' },
            { id: 'lumerra', label: 'Lumerra', termina: 'Marcó Lumerra, una marca que no existe' },
            { id: 'propia', label: 'Marca de la tienda (Great Value, Member’s Mark, Aurrera…)' },
            { id: 'otra', label: 'Otra', otra: true, fija: true },
          ],
          nota: 'Confirmar antes del campo real que Lumerra no exista en México.',
        },
        { id: 'favorita', tipo: 'unica', texto: '¿Cuál es tu marca favorita de {opcion}?', opcionesDe: 'marcas' },
        { id: 'lugar', tipo: 'multiple', texto: '¿Dónde lo compras normalmente?', opciones: SI_NO_TIENDAS },
        {
          id: 'antiguedad', tipo: 'unica', texto: '¿Desde hace cuánto usas {opcion}?',
          opciones: [
            { id: 'menos3m', label: 'Menos de 3 meses', descarta: 'Menos de 3 meses usándolo' },
            { id: '3a6m', label: '3 a 6 meses' },
            { id: '6a12m', label: '6 meses a 1 año' },
            { id: '1a3a', label: '1 a 3 años' },
            { id: 'mas3a', label: 'Más de 3 años' },
          ],
        },
        { id: 'ultima', tipo: 'unica', texto: '¿Cuándo fue la última vez que lo compraste?', opciones: ULTIMA_COMPRA('Última compra hace más de 3 meses (contradice el filtro)') },
        {
          id: 'espacios', tipo: 'multiple', texto: '¿En qué lugares lo usas?',
          opciones: [
            { id: 'sala', label: 'Sala' }, { id: 'comedor', label: 'Comedor' }, { id: 'recamaras', label: 'Recámaras' },
            { id: 'bano', label: 'Baño' }, { id: 'cocina', label: 'Cocina' }, { id: 'entrada', label: 'Entrada o pasillo' },
            { id: 'closet', label: 'Clóset o ropa' }, { id: 'lavado', label: 'Cuarto de lavado' }, { id: 'estudio', label: 'Estudio u oficina en casa' },
            { id: 'auto', label: 'Auto' }, { id: 'otro', label: 'Otro', otra: true },
          ],
        },
        { id: 'foto', tipo: 'foto', texto: 'Sube una foto de tu {opcion} donde se vean la marca y el aroma' },
      ],
    },

    // ── limpiadores ──
    {
      id: 'limp_tipos',
      titulo: 'Limpiadores',
      mostrarSi: { pregunta: 'categorias', incluye: ['limpiadores'] },
      preguntas: [{
        id: 'tipos', tipo: 'multiple', texto: '¿Qué tipos de limpiador compras para tu casa?',
        opciones: [
          { id: 'todo_proposito', label: 'Todo propósito: limpiador líquido para pisos y toda la casa', corto: 'limpiador todo propósito' },
          { id: 'multiusos', label: 'Multiusos: limpiador para varias superficies, normalmente en atomizador', corto: 'limpiador multiusos' },
          { id: 'especializado', label: 'Especializado: para una superficie en particular (cocina, baño, vidrios, madera, metales)', corto: 'limpiador especializado' },
          { id: 'cloro', label: 'Cloro o blanqueador', corto: 'cloro' },
          { id: 'ninguno', label: 'Ninguno de estos', exclusiva: true },
        ],
        nota: 'Cloro solo disimula y no abre bloque.',
      }],
    },
    {
      id: 'limp_bloque',
      titulo: 'Tu {opcion}',
      repetirPor: 'tipos',
      repetirSolo: ['todo_proposito', 'multiusos', 'especializado'],
      preguntas: [
        {
          id: 'superficies', tipo: 'multiple', texto: '¿Para qué superficies compras limpiador especializado?',
          mostrarSi: { instanciaEs: ['especializado'] },
          opciones: [
            { id: 'cocina', label: 'Cocina (grasa, estufa, horno)' }, { id: 'bano', label: 'Baño (sarro, excusado, regadera)' },
            { id: 'vidrios', label: 'Vidrios y espejos' }, { id: 'madera', label: 'Pisos de madera o laminados' },
            { id: 'muebles', label: 'Muebles' }, { id: 'metales', label: 'Metales (acero, cobre)' },
          ],
        },
        {
          id: 'marcas_l', tipo: 'multiple', texto: '¿Qué marcas de {opcion} compras?', aleatorio: true,
          opciones: [
            { id: 'fabuloso', label: 'Fabuloso' }, { id: 'pinol', label: 'Pinol' }, { id: 'maestro', label: 'Maestro Limpio' },
            { id: 'flash', label: 'Flash' }, { id: 'brasso', label: 'Brasso' }, { id: 'musculo', label: 'Mr Músculo' },
            { id: 'lysol', label: 'Lysol' }, { id: 'clorox', label: 'Clorox' }, { id: 'harpic', label: 'Harpic' },
            { id: 'windex', label: 'Windex' }, { id: 'propia', label: 'Marca de la tienda' },
            { id: 'otra', label: 'Otra', otra: true, fija: true },
          ],
        },
        { id: 'favorita_l', tipo: 'unica', texto: '¿Cuál es tu marca favorita de {opcion}?', opcionesDe: 'marcas_l' },
        { id: 'variante', tipo: 'texto', texto: '¿Qué variante o aroma compras? Escríbelo como viene en la etiqueta' },
        {
          id: 'presentacion', tipo: 'multiple', texto: '¿En qué presentación lo compras?',
          opciones: [
            { id: 'diluir', label: 'Líquido que se mezcla con agua' }, { id: 'atomizador', label: 'Listo para usar, con atomizador' },
            { id: 'repuesto', label: 'Repuesto en bolsa o doypack' }, { id: 'gel', label: 'Gel o crema' },
            { id: 'toallitas', label: 'Toallitas' }, { id: 'aerosol', label: 'Aerosol' }, { id: 'polvo', label: 'Polvo' },
          ],
        },
        {
          id: 'tamano', tipo: 'unica', texto: '¿De qué tamaño lo compras normalmente?',
          opciones: [
            { id: 'chico', label: 'Menos de 500 ml' }, { id: 'medio', label: '500 ml a 1 litro' },
            { id: 'grande', label: 'Más de 1 hasta 2 litros' }, { id: 'galon', label: 'Más de 2 litros (garrafa o galón)' },
          ],
        },
        { id: 'lugar_l', tipo: 'multiple', texto: '¿Dónde lo compras normalmente?', opciones: SI_NO_TIENDAS.filter((t) => t.id !== 'decoracion') },
        { id: 'ultima_l', tipo: 'unica', texto: '¿Cuándo fue la última vez que lo compraste?', opciones: ULTIMA_COMPRA('Última compra hace más de 3 meses') },
        {
          id: 'diluye', tipo: 'unica', texto: '¿Cómo lo usas?',
          mostrarSi: { instanciaEs: ['todo_proposito'] },
          opciones: [
            { id: 'cubeta', label: 'Lo mezclo con agua en una cubeta' },
            { id: 'atomizador', label: 'Lo mezclo con agua en un atomizador' },
            { id: 'aveces', label: 'A veces con agua y a veces directo' },
            { id: 'directo', label: 'Siempre directo, sin agua' },
          ],
          nota: '«Siempre directo» cuenta como «otras soluciones»: máximo 2 en Brasso (se revisa a mano).',
        },
      ],
    },
    {
      id: 'limp_foto',
      titulo: 'Tus limpiadores',
      mostrarSi: { pregunta: 'tipos', incluye: ['todo_proposito', 'multiusos', 'especializado'] },
      preguntas: [{ id: 'foto_limpiadores', tipo: 'foto', texto: 'Sube una foto del lugar donde guardas tus limpiadores, que se vean las marcas' }],
    },

    // ── marcas, NSE y participación ──
    {
      id: 'rechazo',
      titulo: 'Marcas',
      preguntas: [{
        id: 'rechazo', tipo: 'multiple', texto: '¿Hay alguna de estas marcas que no comprarías por ningún motivo?', aleatorio: true,
        opciones: [
          { id: 'sabritas', label: 'Sabritas' }, { id: 'airwick', label: 'Air Wick', excluyeGrupos: ['airwick'] },
          { id: 'ariel', label: 'Ariel' }, { id: 'glade', label: 'Glade' }, { id: 'pantene', label: 'Pantene' },
          { id: 'fabuloso', label: 'Fabuloso' }, { id: 'cocacola', label: 'Coca-Cola' },
          { id: 'brasso', label: 'Brasso', excluyeGrupos: ['brasso'] }, { id: 'pinol', label: 'Pinol' }, { id: 'downy', label: 'Downy' },
          { id: 'ninguna', label: 'Ninguna', exclusiva: true, fija: true },
        ],
      }],
    },
    {
      id: 'nse',
      titulo: 'Tu hogar',
      preguntas: [
        {
          id: 'nse_escolaridad', tipo: 'unica', texto: '¿Cuál es el último grado de estudios de la persona que más aporta al gasto de tu casa?',
          opciones: [
            { id: 'ninguno', label: 'No estudió' }, { id: 'prim_inc', label: 'Primaria incompleta' }, { id: 'prim', label: 'Primaria completa' },
            { id: 'sec_inc', label: 'Secundaria incompleta' }, { id: 'sec', label: 'Secundaria completa' },
            { id: 'tecnica', label: 'Carrera técnica o comercial' },
            { id: 'prepa_inc', label: 'Preparatoria incompleta' }, { id: 'prepa', label: 'Preparatoria completa' },
            { id: 'lic_inc', label: 'Licenciatura incompleta' }, { id: 'lic', label: 'Licenciatura completa' },
            { id: 'posgrado', label: 'Diplomado o maestría' }, { id: 'doctorado', label: 'Doctorado' },
          ],
        },
        { id: 'nse_banos', tipo: 'unica', texto: '¿Cuántos baños completos, con regadera y excusado, hay en tu casa?', opciones: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2 o más' }] },
        { id: 'nse_autos', tipo: 'unica', texto: '¿Cuántos autos o camionetas tienen en tu casa?', opciones: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2 o más' }] },
        { id: 'nse_internet', tipo: 'unica', texto: 'Sin contar los datos del celular, ¿tu casa tiene internet?', opciones: [{ id: 'no', label: 'No' }, { id: 'si', label: 'Sí' }] },
        { id: 'nse_trabajan', tipo: 'unica', texto: 'De las personas de 14 años o más que viven en tu casa, ¿cuántas trabajaron el mes pasado?', opciones: ['0', '1', '2', '3', '4'].map((n) => ({ id: n, label: n === '4' ? '4 o más' : n })) },
        { id: 'nse_cuartos', tipo: 'unica', texto: '¿Cuántos cuartos se usan para dormir en tu casa, sin contar pasillos ni baños?', opciones: ['0', '1', '2', '3', '4'].map((n) => ({ id: n, label: n === '4' ? '4 o más' : n })) },
      ],
    },
    {
      id: 'participacion',
      titulo: 'Si te seleccionamos',
      intro: 'El estudio es una visita a tu casa y después acompañarte a la tienda donde compras normalmente. Recibes un incentivo por participar.',
      preguntas: [
        {
          id: 'tienda', tipo: 'unica', texto: '¿En qué tienda física compras más seguido estos productos?',
          opciones: [...SI_NO_TIENDAS.slice(0, 8), { id: 'otra', label: 'Otra', otra: true }],
          nota: 'Aquí será la compra acompañada.',
        },
        { id: 'sucursal', tipo: 'texto', texto: '¿Qué sucursal?', ayuda: 'Por ejemplo: «Plaza Universidad».' },
        {
          id: 'acuerdos', tipo: 'multiple', texto: 'Marca todo con lo que estás de acuerdo',
          opciones: [
            { id: 'visita', label: 'Recibir una visita en mi casa de 60 a 75 minutos' },
            { id: 'tienda', label: 'Que después me acompañen a mi tienda, de 30 a 45 minutos' },
            { id: 'personas', label: 'Que en la visita estén una persona de Sapience y 2 o 3 personas más' },
            { id: 'grabacion', label: 'Que la visita se grabe en audio, video y fotos, solo para investigación' },
            { id: 'videollamada', label: 'Una videollamada de 10 minutos para confirmar, con identificación oficial' },
          ],
          terminaSi: {
            si: { no: { pregunta: 'acuerdos', incluyeTodas: ['visita', 'tienda', 'personas', 'grabacion', 'videollamada'] } },
            motivo: 'No aceptó todas las condiciones de la visita',
          },
        },
        {
          id: 'horarios', tipo: 'multiple', texto: '¿Qué horarios tienes libres en noviembre?',
          opciones: [{ id: 'manana', label: 'Entre semana en la mañana' }, { id: 'tarde', label: 'Entre semana en la tarde' }, { id: 'sabado', label: 'Sábado' }, { id: 'domingo', label: 'Domingo' }],
        },
      ],
    },
  ],

  frentes: [
    ...([
      ['aerosol', 'Aerosoles / Pure', 'aerosol', 6],
      ['reeds', 'Reeds', 'varitas', 6],
      ['room_spray', 'Room Spray', 'spray', 6],
      ['drops', 'Concentrados / Drops', 'gotas', 6],
    ] as const).map(([id, nombre, opcion, meta]) => ({
      id, nombre, grupo: 'airwick', meta,
      califica: { todas: [{ bloque: 'aroma_bloque', opcion }, { numero: 'edad', entre: [25, 55] as [number, number] }, { nse: ['C+'] }] },
    })),
    {
      id: 'deco_auto', nombre: 'Decosphere · con auto', grupo: 'airwick', meta: 3,
      califica: { todas: [{ bloque: 'aroma_bloque', opcion: 'esfera' }, { pregunta: 'espacios', instancia: 'esfera', incluye: ['auto'] }, { numero: 'edad', entre: [25, 55] }, { nse: ['C+'] }] },
    },
    {
      id: 'deco_casa', nombre: 'Decosphere · sin auto', grupo: 'airwick', meta: 3,
      califica: { todas: [{ bloque: 'aroma_bloque', opcion: 'esfera' }, { pregunta: 'espacios', instancia: 'esfera', noIncluye: ['auto'] }, { numero: 'edad', entre: [25, 55] }, { nse: ['C+'] }] },
    },
    {
      id: 'brasso', nombre: 'Brasso / limpiadores', grupo: 'brasso', meta: 10,
      califica: {
        todas: [
          { alguna: [{ numero: 'edad', entre: [25, 40] }, { numero: 'edad', entre: [45, 65] }] },
          {
            alguna: [
              { todas: [{ bloque: 'limp_bloque', opcion: 'especializado' }, { pregunta: 'superficies', instancia: 'especializado', incluye: ['cocina', 'bano', 'vidrios'] }, { nse: ['C+'] }] },
              { todas: [{ bloque: 'limp_bloque', opcion: 'todo_proposito' }, { pregunta: 'diluye', instancia: 'todo_proposito', incluye: ['cubeta', 'atomizador', 'aveces'] }, { nse: ['C', 'C-', 'D+'] }] },
            ],
          },
        ],
      },
    },
  ],

  alertas: [
    { texto: 'Marcó más de 7 aromatizantes: posible sobredeclarante', contar: { pregunta: 'formatos_uso', masDe: 7 } },
  ],

  // Regla AMAI NSE (puntos y cortes de la regla 2018). Confirmar contra la regla vigente antes del campo real.
  nse: {
    puntos: {
      nse_escolaridad: { ninguno: 0, prim_inc: 6, prim: 11, sec_inc: 12, sec: 18, tecnica: 23, prepa_inc: 23, prepa: 27, lic_inc: 36, lic: 59, posgrado: 85, doctorado: 85 },
      nse_banos: { 0: 0, 1: 24, 2: 47 },
      nse_autos: { 0: 0, 1: 22, 2: 43 },
      nse_internet: { no: 0, si: 32 },
      nse_trabajan: { 0: 0, 1: 15, 2: 31, 3: 46, 4: 61 },
      nse_cuartos: { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32 },
    },
    cortes: [
      { nivel: 'A/B', desde: 205 }, { nivel: 'C+', desde: 166 }, { nivel: 'C', desde: 136 }, { nivel: 'C-', desde: 112 },
      { nivel: 'D+', desde: 90 }, { nivel: 'D', desde: 48 }, { nivel: 'E', desde: 0 },
    ],
  },
};
