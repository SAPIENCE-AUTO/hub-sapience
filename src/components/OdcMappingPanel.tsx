import { useState } from 'react';
import { ParseOdcCsvOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { FolderPlus, Building2, ChevronDown, ChevronRight, CheckCircle2, MinusCircle } from 'lucide-react';
import SearchableSelect, { SelectOption } from './SearchableSelect';

type Preview = ParseOdcCsvOutputType;

interface Props {
  preview: Preview;
  projectMappings: Record<string, string>;
  supplierMappings: Record<string, string>;
  onProjectMap: (code: string, decision: string) => void;
  onSupplierMap: (key: string, decision: string) => void;
}

export default function OdcMappingPanel({ preview, projectMappings, supplierMappings, onProjectMap, onSupplierMap }: Props) {
  const [showProjects, setShowProjects] = useState(true);
  const [showSuppliers, setShowSuppliers] = useState(true);

  const hasIssues = preview.projectsToCreate.length > 0 || preview.suppliersNotFound.length > 0;
  if (!hasIssues) return null;

  const projectOptions: SelectOption[] = [
    { value: 'create', label: '➕ Crear proyecto nuevo' },
    { value: 'skip', label: '⏭️ Dejar sin vincular', sub: 'Se importa la ODC sin proyecto' },
    ...preview.existingProjects.map(p => ({
      value: p.code,
      label: p.code,
      sub: p.fullName || undefined,
    })),
  ];

  const supplierOptions: SelectOption[] = [
    { value: 'raw', label: '📝 Guardar nombre del CSV' },
    { value: 'create', label: '➕ Crear proveedor nuevo en BD' },
    ...preview.existingSuppliers.map(s => ({
      value: s.name,
      label: s.name,
      sub: s.rfc ? `RFC: ${s.rfc}` : undefined,
    })),
  ];

  const projectDecisionLabel = (decision: string) => {
    if (!decision || decision === 'create') return '➕ Crear proyecto nuevo';
    return decision;
  };

  const supplierDecisionLabel = (decision: string) => {
    if (!decision || decision === 'raw') return '📝 Guardar nombre del CSV';
    if (decision === 'create') return '➕ Crear proveedor nuevo en BD';
    return decision;
  };

  return (
    <div className="space-y-3">
      {/* Projects */}
      {preview.projectsToCreate.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-medium text-amber-800">
                {preview.projectsToCreate.length} proyectos no encontrados en BD
              </p>
            </div>
            <Button size="sm" variant="ghost" className="text-amber-700 text-xs h-7 gap-1" onClick={() => setShowProjects(p => !p)}>
              {showProjects ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showProjects ? 'Colapsar' : 'Resolver'}
            </Button>
          </div>
          {showProjects && (
            <div className="space-y-2">
              <p className="text-xs text-amber-700">
                Para cada proyecto del CSV, elige si crearlo nuevo o vincularlo a uno existente:
              </p>
              {preview.projectsToCreate.map(code => {
                const decision = projectMappings[code] ?? 'create';
                const isLinkedToExisting = decision !== 'create' && decision !== 'skip';
                const isSkip = decision === 'skip';
                return (
                  <div key={code} className="flex items-center gap-3 bg-white/60 rounded-lg px-3 py-2 border border-amber-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{code}</p>
                    </div>
                    {isLinkedToExisting && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                    {isSkip && <MinusCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <SearchableSelect
                      value={decision}
                      onChange={v => onProjectMap(code, v)}
                      options={projectOptions}
                      placeholder="Elegir acción…"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Suppliers */}
      {preview.suppliersNotFound.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-orange-600" />
              <p className="text-sm font-medium text-orange-800">
                {preview.suppliersNotFound.length} proveedores sin match por RFC/email/nombre
              </p>
            </div>
            <Button size="sm" variant="ghost" className="text-orange-700 text-xs h-7 gap-1" onClick={() => setShowSuppliers(p => !p)}>
              {showSuppliers ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showSuppliers ? 'Colapsar' : 'Resolver'}
            </Button>
          </div>
          {showSuppliers && (
            <div className="space-y-2">
              <p className="text-xs text-orange-700">
                Para cada proveedor, elige si guardar el nombre tal como viene, crear en BD, o vincularlo a uno existente:
              </p>
              {preview.suppliersNotFound.map((s, i) => {
                const key = s.rfc || s.name || `row-${i}`;
                const decision = supplierMappings[key] ?? (s.suggestedMatch ?? 'raw');
                const isLinked = decision !== 'raw' && decision !== 'create';
                const isCreating = decision === 'create';
                const hasSuggestion = !!s.suggestedMatch && (s.suggestedScore ?? 0) > 0.4;
                const isUsingSuggestion = hasSuggestion && decision === s.suggestedMatch;
                return (
                  <div key={key} className="flex items-start gap-3 bg-white/60 rounded-lg px-3 py-2 border border-orange-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{s.name || '—'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <p className="text-[10px] text-muted-foreground">
                          {s.rfc ? `RFC: ${s.rfc}` : 'Sin RFC'} · {s.odcCount} ODC{s.odcCount !== 1 ? 's' : ''}
                        </p>
                        {hasSuggestion && isUsingSuggestion && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium border border-primary/20">
                            ✨ sugerido {s.suggestedScore ? `${Math.round(s.suggestedScore * 100)}%` : ''}
                          </span>
                        )}
                        {hasSuggestion && !isUsingSuggestion && decision === 'raw' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                            posible: {s.suggestedMatch}
                          </span>
                        )}
                      </div>
                    </div>
                    {(isLinked || isCreating) && (
                      <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isCreating ? 'text-amber-500' : 'text-primary'}`} />
                    )}
                    <SearchableSelect
                      value={decision}
                      onChange={v => onSupplierMap(key, v)}
                      options={supplierOptions}
                      placeholder="Elegir acción…"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
