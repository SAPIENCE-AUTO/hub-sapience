# Capa de compatibilidad Zite → Postgres

Reimplementa la superficie del SDK de Zite que usan los 207 endpoints, sobre Postgres.
El objetivo es que portar un endpoint sea **cambiar una línea**:

```diff
- import { z } from 'zod';
- import { createEndpoint, Deals } from 'zite-integrations-backend-sdk';
+ import { z } from 'zod';
+ import { createEndpoint, Deals } from '../compat';
```

## Por qué existe

Separa dos problemas que no conviene resolver a la vez: *salir de Zite* y *que sea rápido*.
Con esta capa el port mantiene paridad de comportamiento; la optimización viene después,
selectivamente, en los caminos calientes (`saveCellValue`, `getDashboardData`,
`getSharedViewData`, `getMultiProjectCostAnalysis`).

## La regla de fidelidad más importante

En Zite los `linked_record` se guardan como **arreglos de IDs**, incluso en relaciones 1-N.
Por eso el código existente hace `filters: { deal: { contains: dealId } }` y `toIds(p.analistas)`.

Esta capa preserva ese contrato: los links se **leen** siempre como `string[]` y se **escriben**
aceptando `string` o `string[]`. La traducción a FK y a tablas puente vive aquí y en ningún
otro lugar. Si esto se rompe, se rompen los 207 endpoints a la vez.

## Superficie implementada

Con la frecuencia real de uso en el código, para saber qué importa:

| Método | Usos | Firma |
|---|---|---|
| `findAll` | 365 | `{ filters?, limit?, offset?, fields?, sorts? }` → `{ records }` |
| `update` | 160 | `{ id, record }` |
| `findOne` | 117 | `{ id, fields? }` o `{ filters, fields? }` → registro o `null` |
| `create` | 87 | `{ record }` → registro creado |
| `bulkCreate` | 49 | `{ records }` → `{ records }`, en transacción |
| `delete` | 49 | `{ id }` |
| `count` | — | añadido, no existía |

Operadores de filtro: `contains` (29 usos) · `in` (24) · `not` (4) · `gt` (3) · `gte` (2) · `lte` (1),
más igualdad implícita. `contains` cambia de significado según el tipo de campo:
sobre link es pertenencia (igualdad de FK), sobre `text[]` es `@>`, sobre texto es `ILIKE '%…%'`.

## Diferencias deliberadas con Zite

Tres, todas para atrapar bugs que Zite dejaba pasar en silencio:

1. **Filtrar por un campo inexistente lanza error.** En Zite devolvía la tabla completa,
   lo que convierte un typo en una fuga de datos silenciosa.
2. **`findAll` sin filtros aplica un límite de 1000.** Hay 190 llamadas sin filtro en el
   código; sin tope, cualquiera de ellas escanea la tabla entera. Configurable por llamada.
3. **La salida se valida contra el `outputSchema`.** Con `STRICT_OUTPUT=true` lanza error;
   sin la variable solo advierte. Útil durante el port para detectar desalineaciones.

## Archivos

| Archivo | Rol | Generado |
|---|---|---|
| `schema-map.ts` | Mapeo propiedad camelCase → columna, y descriptores de relación | sí |
| `types.ts` | Los `*RecordType` que importan algunos endpoints | sí |
| `model.ts` | El constructor de modelos: los 6 métodos sobre SQL | no |
| `filters.ts` | Traductor de filtros a `WHERE` | no |
| `endpoint.ts` | Réplica de `createEndpoint` con validación zod | no |
| `errors.ts` | Réplica de `ZiteError` y su mapeo a códigos HTTP | no |
| `db.ts` | Pool de Postgres | no |
| `index.ts` | Exporta los 41 modelos y el resto | sí |

Los generados salen de `generate.py`, **la misma fuente que `schema.sql`**. Eso es
deliberado: cuando estaban separados, el DDL perdió una columna `updated_at` y el mapeo
siguió esperándola. No regenerar uno sin el otro.

## Pendiente

- `context.user` viene del shim de autenticación; conectar con Supabase Auth.
- El endpoint `analyzeRecruitmentStatus` usa `stream`; ese parámetro está declarado pero no implementado.
- `sorts` no lo usa el código actual, pero está soportado.
