/**
 * El título y el ícono del Hub. index.html no los trae porque en el dominio de
 * los participantes (sharpli.mx) no deben aparecer, ni siquiera en el código
 * que se descarga: main.tsx carga este archivo solo para el Hub.
 */
document.title = 'Hub Sapience';
for (const [type, href, sizes] of [['image/svg+xml', '/favicon.svg'], ['image/png', '/favicon-32.png', '32x32']]) {
  const link = Object.assign(document.createElement('link'), { rel: 'icon', type, href });
  if (sizes) link.setAttribute('sizes', sizes);
  document.head.appendChild(link);
}

export {};
