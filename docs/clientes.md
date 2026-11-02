# Catálogo de clientes

Guía viva del catálogo de **Clientes** (`/comercial/clientes`): a quién se le factura (razones sociales), qué pide cada cliente para cobrarle (días de crédito, portal, GR/Migo, orden de compra, proforma, instrucciones) y a quién escribirle (contactos). **Cobranza lee de aquí**, y la facturación que viene (con Alegra u otro proveedor) saldrá de aquí.

## Quién lo ve

Owner o nivel de compra Finanzas, igual que Cobranza (`exigirAccesoClientes` en `src/serverUtils/clientes/acceso.ts`; el candado del menú y de la página es cosmético). Entrada de menú «Clientes» dentro de Comercial.

## Datos

`clients` no se toca: sigue siendo solo el nombre y el enlace con Sharpli (`sharpli_client_id`). Lo de negocio vive en tablas aparte, declaradas en `server/generate.py` (EXTRA_TABLES) y creadas en producción con `server/scripts/add-clientes-ficha-tables.ts` (idempotente, **no se ejecuta solo**).

- `client_entities` — **razones sociales** de un cliente (a quién se le factura). Datos para facturar (CFDI 4.0): `legal_name`, `rfc`, `tax_regime` (clave SAT: `601`), `postal_code` (fiscal), `cfdi_use` (`G03`), `payment_method` (`PUE`/`PPD`), `payment_form` (`03`, `99`…), `billing_emails`. Condiciones de cobro: `credit_days`, `requires_po`, `requires_portal` + `portal_url`, `requires_gr`, `requires_proforma`, `process_notes`. `deactivated_at` vacío = activa. Un RFC no se repite dentro del mismo cliente (índice parcial), sí en otro.
- `client_contacts` — contactos de cobranza: nombre, correo, teléfono, rol (`Recibe facturas`, `Libera pagos`, `Seguimiento`, `Otro`), notas; `entity_id` vacío = contacto de todo el cliente.
- `collection_processes.client_entity_id` — la razón social del proceso; `applicable_phases` (columna que venía de Zite y nadie usaba) guarda como JSON los pasos que aplican.

Sin defaults de BD a propósito: una bandera en `null` es «no».

## Reglas

- Régimen fiscal, uso del CFDI y forma de pago se guardan por **clave del SAT**; las etiquetas viven en `src/lib/clientes/catalogos.ts`.
- `saveClientEntity` es un **reemplazo completo** de los campos editables: lo que no viene (o viene vacío) se guarda como `null`. Activar/desactivar es un endpoint aparte (`setClientEntityActive`) para no borrar datos por accidente.
- Validación en `src/serverUtils/clientes/entidad.ts` (RFC de 12/13 caracteres, CP de 5 dígitos, correos, catálogos, días 0–365) con mensajes en español.
- Los pasos del proceso de un cliente salen de las banderas (`fasesQueAplican` en `src/lib/clientes/fases.ts`): sin banderas son factura creada → enviada → cobranza programada → pagada; portal, GR/Migo y proforma se acomodan en su lugar.
- «Cobro listo» = tiene días de crédito. «Fiscal listo» = razón social, RFC, régimen, CP fiscal y uso del CFDI (`faltanParaCobrar` / `faltanParaFacturar`).

## Cómo lo usa Cobranza

- **Iniciar proceso** (`StartCollectionProcessDialog`): `getClientCollectionTerms` busca el cliente (por proyecto: su `client_id` o, si no tiene, su nombre) y ofrece sus razones sociales activas; al elegir una vienen los días de crédito, los pasos y las instrucciones. Si el cliente tiene razones sociales, hay que elegir una. Sin razón social o fuera del catálogo, sigue funcionando a mano y avisa con la liga a Clientes. `startCollectionProcess` guarda `client_id`, `client_entity_id` y `applicable_phases`, y **ya no escribe en `clients`** (antes tronaba al guardar días de crédito en una columna que se había quitado el 2026-09-23).
- **Pestaña del proyecto** (`CollectionProcessTab`): tarjeta «Cliente y razón social» (asignar o cambiar la razón social, RFC, condiciones, instrucciones, contactos) y la barra de pasos muestra solo los que aplican. Asignar la razón social a un proceso sin días de crédito (los 20 heredados) toma los de la razón social; si ya los tiene, no se pisan.

## Facturación (por venir)

Lo que ya quedó listo para que la factura salga de aquí sin rehacer nada: los datos del receptor (RFC, CP fiscal, régimen, uso del CFDI, método y forma de pago, correos) viven en la razón social, y el proceso de cobranza ya apunta a ella. Pendiente cuando llegue el módulo: elegir proveedor de facturación, enlazar cada razón social con su contacto en ese proveedor, series/folios de las empresas operadoras (`billing_entities`), que `invoices` (hoy casi vacía) guarde UUID fiscal y estado, que Cobranza arranque desde la factura timbrada y el complemento de pago al cobrar una factura PPD.

## Pruebas

`server/scripts/test-clientes.ts` (29, base en memoria con el esquema real y datos inventados): validación y limpieza, candado, un RFC por cliente, desactivar sin borrar, contactos, conteos del catálogo, búsqueda del cliente por id / proyecto / nombre, y Cobranza (iniciar con razón social, asignarla a un proceso heredado, detalle).

`cd server && npx tsx scripts/test-clientes.ts` · en producción: `cd server && npx tsx --env-file=../.env scripts/add-clientes-ficha-tables.ts` (solo con visto bueno).

## Historial

- 2026-11-01 — catálogo v1 (razones sociales, contactos, Cobranza leyendo de aquí, barra de pasos con líneas continuas). Sin cargar datos todavía: lo siguiente es capturar los 8 clientes más grandes.
