/**
 * El acuerdo de confidencialidad que se acepta al final de todo filtro (pedido de Sergio, 2026-11-06): con «Leí y acepto», sin firma dibujada. Es el mismo texto del NDA que firma quien
 * confirman a una sesión (src/serverUtils/nda/correo.ts, NDA_SECCIONES) con lo único que cambia al aceptar con un clic en lugar de firmar: «Al firmar» pasa a «Al marcar «Leí y acepto»»
 * y se quita lo de «la firma que aparece aquí es mía» y «mi firma» (aquí no hay firma). Una prueba (test-pasos-legales.ts) compara los dos textos para que no se separen sin querer:
 * si el abogado cambia uno, hay que decidir qué pasa con el otro. Si este texto cambia, subir ACUERDO_VERSION (queda guardada con cada aceptación, con la huella del texto).
 */
export const ACUERDO_VERSION = '2026-11-06';
export const ACUERDO_TITULO = 'ACUERDO DE CONFIDENCIALIDAD, CONSENTIMIENTO INFORMADO Y RESPONSIVA';

export interface AcuerdoSeccion { titulo: string; parrafos: string[] }

export const ACUERDO_SECCIONES: AcuerdoSeccion[] = [
  {
    titulo: '1. Confidencialidad',
    parrafos: [
      'Me comprometo a mantener absoluta confidencialidad sobre toda la información, productos, materiales y comentarios que pueda observar o probar durante mi participación en la sesión de investigación de mercados organizada por ASESORES GLOBALES CORPORATIVOS SC (en adelante, “la Agencia”).',
      'Entiendo que dicha información es confidencial y no podrá ser divulgada, compartida o utilizada fuera de este contexto bajo ninguna circunstancia.',
    ],
  },
  {
    titulo: '2. Consentimiento informado',
    parrafos: [
      'Declaro que he sido informado(a) de que durante la sesión tendré acceso a información confidencial que no podré compartir ni divulgar.',
      'Reconozco que mi participación es completamente voluntaria, y acepto participar en el estudio por mi propia voluntad.',
    ],
  },
  {
    titulo: 'Declaraciones finales',
    parrafos: [
      'Por la presente, confirmo que participo en esta actividad de manera consciente y voluntaria, y que he tenido la oportunidad de resolver todas las dudas relacionadas con mi participación.',
      'Al marcar «Leí y acepto», acepto los términos y condiciones de este acuerdo y confirmo que soy mayor de edad, que lo leí y lo entendí.',
      'Conozco el aviso de privacidad de Asesores Globales Corporativos SC, disponible en sharpli.mx/f/aviso, y acepto que se registren mi nombre, la fecha y hora, mi dispositivo y mi dirección IP como constancia de esta aceptación.',
    ],
  },
];

/** El texto completo, tal como se lee en la pantalla (sin el renglón con el nombre): de aquí sale la huella que se guarda con cada aceptación. */
export const acuerdoEnTexto = (): string => [ACUERDO_TITULO, ...ACUERDO_SECCIONES.flatMap((s) => [s.titulo, ...s.parrafos])].join('\n');
