import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core';
import { createReactInlineContentSpec } from '@blocknote/react';
import ReferenceChip from './ReferenceChip';

export type ReferenceType = 'user' | 'project' | 'event' | 'group';

/**
 * Reemplaza a RefInline de docTypes.ts. Se guarda en el documento nativo de
 * BlockNote como inline content propio en vez de una marca de texto — ver
 * legacyConverter.ts para el mapeo desde documentos viejos.
 */
export const referenceInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'reference',
    propSchema: {
      refType: { default: 'user' as ReferenceType },
      refId: { default: '' },
      label: { default: '' },
    },
    content: 'none',
  },
  { render: ReferenceChip },
);

export const docSchema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    reference: referenceInlineContentSpec,
  },
});

export type DocSchemaEditor = typeof docSchema.BlockNoteEditor;
