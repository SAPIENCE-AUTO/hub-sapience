import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Convierte Markdown a HTML real (##, **, -, *itálica*) reusando react-markdown
// — el mismo parser que ya renderiza el resumen en pantalla, en vez de
// escribir un parser propio — para "copiar minuta" y el correo generado con
// formato real de negritas/viñetas al pegar en Outlook/Word/Gmail, en vez de
// asteriscos y guiones literales.
export function markdownToHtml(markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown>{markdown}</ReactMarkdown>);
}

// Copia HTML real al portapapeles con un fallback de texto plano — para que
// Outlook/Word/Gmail peguen viñetas y negritas de verdad, y un editor de
// puro texto siga recibiendo algo legible. Devuelve si tuvo éxito, para que
// el caller decida qué toast mostrar.
//
// Primero intenta el método clásico — seleccionar un nodo real del DOM ya
// renderizado con el HTML y usar execCommand('copy') — porque es
// exactamente el mismo mecanismo de "seleccionar texto de una página y
// pegarlo en Word/Outlook", con más de una década de compatibilidad
// probada entre apps de escritorio. Confirmado con datos reales que
// navigator.clipboard.write con ClipboardItem (el método "moderno") SÍ
// resuelve sin error, pero el HTML no siempre sobrevive el viaje hasta
// Outlook — execCommand no tiene ese problema porque usa la misma ruta que
// el navegador ya usa para copiar contenido seleccionado de cualquier
// página. Si execCommand no está disponible, cae a la Clipboard API async.
export async function copyRichText(html: string, plainText: string): Promise<boolean> {
  if (document.queryCommandSupported?.('copy')) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.whiteSpace = 'pre-wrap';
    container.setAttribute('contenteditable', 'true');
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const copied = document.execCommand('copy');
      selection?.removeAllRanges();
      if (copied) return true;
    } catch {
      // sigue al fallback de abajo
    } finally {
      document.body.removeChild(container);
    }
  }

  try {
    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch {
    return false;
  }
}
