import { preguntasNse, reglaNse } from '../nse';
import type { Definicion, Opcion } from '../tipos';

/**
 * Screener de prueba con todos los tipos de pregunta de la fase 1 de Filtros
 * (dirección, listas, imágenes, matrices, escalas, ordenar, casilla,
 * interruptor y pantallas sin pregunta), con lógica, frentes y NSE. Sirve
 * para probar el formulario, el panel, el Excel y el tablero; no es un
 * estudio. Las imágenes van dibujadas aquí mismo para no depender de una
 * carpeta pública (subirlas es de la fase 2).
 */

const imagen = (dibujo: string, fondo = '#EEECEA') =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${fondo}"/><g fill="none" stroke="#3F3F46" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${dibujo}</g></svg>`,
  )}`;

const LATA = imagen('<rect x="70" y="50" width="60" height="110" rx="10" fill="#D6D3D1"/><ellipse cx="100" cy="50" rx="30" ry="8" fill="#E7E5E4"/><path d="M92 42v-12h16v12"/>');
const BOTELLA = imagen('<path d="M86 30h28v22l12 16v92a8 8 0 0 1-8 8H82a8 8 0 0 1-8-8V68l12-16z" fill="#D6D3D1"/><path d="M74 100h52"/>');
const FRASCO = imagen('<rect x="60" y="70" width="80" height="95" rx="14" fill="#D6D3D1"/><rect x="66" y="48" width="68" height="22" rx="5" fill="#A8A29E"/>');
const BOLSA = imagen('<path d="M72 40h56l14 120a6 6 0 0 1-6 7H64a6 6 0 0 1-6-7z" fill="#D6D3D1"/><path d="M80 56h40"/>');
const VELA = imagen('<rect x="66" y="90" width="68" height="75" rx="8" fill="#D6D3D1"/><path d="M100 90V76"/><path d="M100 46c-9 11-9 22 0 26 9-4 9-15 0-26z" fill="#F5D0A9"/>');
const VARITAS = imagen('<path d="M100 120 78 34M100 120l8-90M100 120l22-80"/><rect x="72" y="110" width="56" height="55" rx="10" fill="#D6D3D1"/>');

const CONCEPTO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340"><rect width="600" height="340" fill="#F5F5F4"/>'
  + '<path d="M150 70c-45 60-60 100-60 125a60 60 0 0 0 120 0c0-25-15-65-60-125z" fill="#D6D3D1" stroke="#3F3F46" stroke-width="6"/>'
  + '<text x="260" y="140" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#27272A">Gotas que duran</text>'
  + '<text x="260" y="182" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#27272A">30 días</text>'
  + '<text x="260" y="226" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#52525B">Concentrado que se recarga.</text>'
  + '<text x="260" y="254" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#52525B">Concepto de prueba.</text></svg>',
)}`;

const FRUTAS = [
  'Aguacate', 'Durazno', 'Fresa', 'Guayaba', 'Kiwi', 'Limón', 'Mamey', 'Mandarina', 'Mango', 'Manzana', 'Melón',
  'Naranja', 'Papaya', 'Pera', 'Piña', 'Plátano', 'Sandía', 'Toronja', 'Tuna', 'Uva', 'Zarzamora', 'Arándano',
  'Ciruela', 'Granada', 'Lima',
];

const deTexto = (lista: string[]): Opcion[] =>
  lista.map((label) => ({ id: label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }));

export const PRUEBA_TIPOS: Definicion = {
  version: 2,
  pais: 'MX',
  tituloPublico: 'Cuestionario de prueba',
  bienvenida: 'Este cuestionario sirve para probar todos los tipos de pregunta. Contestarlo toma unos 5 minutos.',
  despedida: '¡Gracias! Tus respuestas quedaron guardadas.',
  noCalifica: '¡Gracias por tu tiempo! Por ahora tu perfil no coincide con lo que buscamos.',
  claves: { nombre: 'nombre', telefono: 'celular', edad: 'edad', genero: 'genero' },

  secciones: [
    {
      id: 'inicio',
      titulo: 'Antes de empezar',
      preguntas: [
        { id: 'instrucciones', tipo: 'contenido', texto: 'Contesta como lo harías normalmente. No hay respuestas buenas ni malas.' },
        { id: 'aviso', tipo: 'casilla', texto: 'Leí y acepto el aviso de privacidad', ayuda: 'Tus datos solo se usan para invitarte a estudios.' },
      ],
    },
    {
      id: 'perfil',
      titulo: 'Sobre ti',
      preguntas: [
        { id: 'nombre', tipo: 'texto', texto: 'Nombre completo' },
        { id: 'celular', tipo: 'telefono', texto: 'Celular (WhatsApp)' },
        { id: 'correo', tipo: 'correo', texto: 'Correo', opcional: true },
        { id: 'genero', tipo: 'unica', texto: 'Eres…', opciones: [{ id: 'mujer', label: 'Mujer' }, { id: 'hombre', label: 'Hombre' }, { id: 'otro', label: 'Otro / prefiero no decir' }] },
        { id: 'edad', tipo: 'numero', texto: '¿Cuántos años tienes?', min: 15, max: 99, terminaFuera: { min: 18, max: 65, motivo: 'Edad fuera de 18 a 65' } },
        { id: 'domicilio', tipo: 'direccion', texto: '¿Cuál es la dirección de tu casa?', ayuda: 'Solo la usamos si te visitamos.' },
      ],
    },
    {
      id: 'compras',
      titulo: 'Tus compras',
      preguntas: [
        {
          id: 'tienda', tipo: 'lista', texto: '¿En qué tipo de tienda haces la mayor parte de tus compras?',
          opciones: [
            ...deTexto(['Supermercado', 'Tienda de autoservicio grande', 'Club de precios', 'Tienda de conveniencia', 'Tienda de la esquina', 'Mercado', 'Tianguis', 'Farmacia', 'Tienda departamental', 'Tienda en línea', 'Mayorista', 'Tienda de descuento', 'Venta por catálogo']),
            { id: 'otra', label: 'Otra', otra: true },
            { id: 'nadie', label: 'No hago compras para mi casa', termina: 'No hace compras para su casa' },
          ],
        },
        { id: 'frutas', tipo: 'lista_multiple', texto: '¿Qué frutas compraste este mes?', maxOpciones: 5, opciones: [...deTexto(FRUTAS), { id: 'ninguna', label: 'Ninguna', exclusiva: true }] },
      ],
    },
    {
      id: 'empaques',
      titulo: 'Empaques',
      preguntas: [
        {
          id: 'empaque', tipo: 'imagen_unica', texto: '¿Qué empaque te llama más la atención?',
          opciones: [
            { id: 'lata', label: 'Lata', imagen: LATA }, { id: 'botella', label: 'Botella', imagen: BOTELLA },
            { id: 'frasco', label: 'Frasco', imagen: FRASCO }, { id: 'bolsa', label: 'Bolsa', imagen: BOLSA },
          ],
        },
        {
          id: 'formatos', tipo: 'imagen_multiple', texto: '¿Cuáles de estos aromatizantes has usado en tu casa?',
          opciones: [
            { id: 'aerosol', label: 'Aerosol', imagen: LATA }, { id: 'spray', label: 'Spray sin gas', imagen: BOTELLA },
            { id: 'vela', label: 'Vela', imagen: VELA }, { id: 'varitas', label: 'Difusor de varitas', imagen: VARITAS },
            { id: 'ninguno', label: 'Ninguno', exclusiva: true },
          ],
        },
      ],
    },
    {
      id: 'casa',
      titulo: 'En tu casa',
      preguntas: [
        {
          id: 'frecuencia', tipo: 'matriz', texto: '¿Cada cuánto haces cada cosa?',
          filas: [{ id: 'barrer', label: 'Barrer' }, { id: 'trapear', label: 'Trapear' }, { id: 'ropa', label: 'Lavar la ropa' }],
          opciones: [{ id: 'diario', label: 'Diario' }, { id: 'semana', label: 'Cada semana' }, { id: 'mes', label: 'Cada mes' }, { id: 'nunca', label: 'Nunca' }],
        },
        {
          id: 'lugares', tipo: 'matriz_multiple', texto: '¿Dónde usas cada producto?', ayuda: 'Puedes marcar varios lugares en cada uno.',
          filas: [{ id: 'aromatizante', label: 'Aromatizante' }, { id: 'limpiador', label: 'Limpiador' }, { id: 'toallitas', label: 'Toallitas' }],
          opciones: [{ id: 'casa', label: 'Casa' }, { id: 'auto', label: 'Auto' }, { id: 'oficina', label: 'Oficina' }, { id: 'no_uso', label: 'No lo uso' }],
        },
        { id: 'mascota', tipo: 'interruptor', texto: '¿Tienes mascota?' },
        {
          id: 'mascota_cual', tipo: 'unica', texto: '¿Qué mascota tienes?', mostrarSi: { pregunta: 'mascota', incluye: ['si'] },
          opciones: [{ id: 'perro', label: 'Perro' }, { id: 'gato', label: 'Gato' }, { id: 'otra', label: 'Otra', otra: true }],
        },
      ],
    },
    {
      id: 'concepto',
      titulo: 'Una idea nueva',
      intro: 'Lee con calma la siguiente idea antes de seguir.',
      preguntas: [{ id: 'concepto_gotas', tipo: 'contenido', texto: 'Un aromatizante en gotas que dura 30 días y se recarga.', imagen: CONCEPTO }],
    },
    {
      id: 'opinion',
      titulo: 'Tu opinión de la idea',
      preguntas: [
        { id: 'probabilidad', tipo: 'escala', texto: '¿Qué tan probable es que lo compres?', min: 0, max: 10, etiquetas: { min: 'Nada probable', max: 'Muy probable' } },
        { id: 'agrado', tipo: 'estrellas', texto: '¿Qué tanto te gusta?' },
        { id: 'peso_aroma', tipo: 'deslizador', texto: '¿Qué tanto pesa el aroma cuando eliges un aromatizante?', min: 0, max: 100, paso: 5, etiquetas: { min: 'Nada', max: 'Muchísimo' } },
        {
          id: 'atributos', tipo: 'ordenar', texto: 'Ordena de lo que más a lo que menos te importa', aleatorio: true,
          opciones: deTexto(['Aroma', 'Duración', 'Precio', 'Diseño', 'Que sea fácil de usar']),
        },
      ],
    },
    { id: 'nse', titulo: 'Tu hogar', preguntas: preguntasNse('MX') },
    {
      id: 'cierre',
      titulo: 'Para terminar',
      preguntas: [
        { id: 'foto_producto', tipo: 'foto', texto: 'Si quieres, sube una foto de un producto que uses en tu casa', opcional: true },
        { id: 'whatsapp', tipo: 'casilla', texto: 'Acepto que me contacten por WhatsApp', opcional: true },
        { id: 'comentarios', tipo: 'texto_largo', texto: '¿Algo más que quieras contarnos?', opcional: true },
      ],
    },
  ],

  frentes: [
    { id: 'lata', nombre: 'Prefiere lata', grupo: 'prueba', meta: 3, califica: { todas: [{ pregunta: 'empaque', incluye: ['lata'] }, { nse: ['A/B', 'C+'] }] } },
    { id: 'otro_empaque', nombre: 'Prefiere otro empaque', grupo: 'prueba', meta: 3, califica: { todas: [{ pregunta: 'empaque', noIncluye: ['lata'] }, { nse: ['C', 'C-'] }] } },
  ],

  alertas: [
    { texto: 'Le dio 1 o 2 estrellas a la idea', si: { numero: 'agrado', entre: [1, 2] } },
    { texto: 'Marcó los 4 aromatizantes', contar: { pregunta: 'formatos', masDe: 3 } },
  ],

  nse: reglaNse('MX'),
};
