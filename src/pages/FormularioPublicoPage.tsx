import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PaginaAviso } from '@/components/formularios/AvisoPrivacidad';
import { Loader2 } from 'lucide-react';
import { getFormularioPublico, submitFormularioRespuesta } from 'zite-endpoints-sdk';
import type { Definicion } from '@/lib/formularios/tipos';
import { Participante, type Borrador } from '@/components/formularios/Participante';

type Fase = 'cargando' | 'noexiste' | 'cerrado' | 'listo' | 'error';

const leer = <T,>(clave: string): T | null => { try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const guardar = (clave: string, v: unknown) => { try { localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const borrar = (clave: string) => { try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ } };

function dispositivo(): string {
  const guardado = leer<string>('formularios_device');
  if (guardado) return guardado;
  const nuevo = crypto.randomUUID();
  guardar('formularios_device', nuevo);
  return nuevo;
}

/**
 * Página pública `/f/:codigo` de Tools → Formularios — hermana de <Layout>
 * en App.tsx, nunca pasa por useAuth(). El formulario en sí es <Participante>,
 * el mismo que prueba la vista Celular del editor. Lo contestado se guarda en
 * el celular mientras tanto, así recargar no borra nada. Si una respuesta
 * descarta, se envía lo que hay y se despide sin decir por qué.
 */
export default function FormularioPublicoPage() {
  const { codigo = '' } = useParams<{ codigo: string }>();
  // /f/aviso: el aviso de privacidad solo, para mandar el enlace (ningún código de formulario tiene 5 letras).
  if (codigo === 'aviso') return <PaginaAviso />;
  return <Formulario codigo={codigo} />;
}

function Formulario({ codigo }: { codigo: string }) {
  const claveBorrador = `formulario_${codigo}`;
  const [fase, setFase] = useState<Fase>('cargando');
  const [def, setDef] = useState<Definicion | null>(null);
  const [prueba, setPrueba] = useState(false);
  const [inicial, setInicial] = useState<Borrador | null>(null);
  const device = useMemo(dispositivo, []);

  useEffect(() => {
    getFormularioPublico({ codigo })
      .then((r) => {
        if (!r.found) return setFase('noexiste');
        if (r.estado === 'cerrado') return setFase('cerrado');
        setDef(r.definicion);
        setPrueba(r.estado === 'prueba');
        setInicial(leer<Borrador>(claveBorrador));
        setFase('listo');
      })
      .catch(() => setFase('error'));
  }, [codigo, claveBorrador]);

  if (fase === 'cargando') return <Mensaje><Loader2 className="mx-auto h-6 w-6 animate-spin" /></Mensaje>;
  if (fase === 'noexiste') return <Mensaje>Este enlace no existe o todavía no está disponible.</Mensaje>;
  if (fase === 'cerrado') return <Mensaje>Este cuestionario ya cerró. ¡Gracias por tu interés!</Mensaje>;
  if (fase === 'error' || !def) return <Mensaje>No pudimos cargar el cuestionario. Revisa tu conexión y vuelve a intentar.</Mensaje>;

  return (
    <Participante
      def={def}
      prueba={prueba}
      codigo={codigo}
      semilla={device}
      inicial={inicial}
      onAvance={(b) => guardar(claveBorrador, b)}
      onEnviar={async (respuestas, duracionSeg) => {
        await submitFormularioRespuesta({ codigo, respuestas, deviceToken: device, duracionSeg });
        borrar(claveBorrador);
      }}
      onOtraVez={() => borrar(claveBorrador)}
    />
  );
}

function Mensaje({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-[#F6F6F7] px-6 text-center text-[15px] text-[#62626B]">{children}</div>;
}
