import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { exportExcel, exportPdf, type ExportSpec } from '@/lib/exportTable';

// Gumb "Izvoz" s izbornikom PDF / Excel; spec se gradi tek pri kliku, pa uvijek vrijedi trenutni filtar
export function ExportMenu<T>({ build, disabled }: { build: () => ExportSpec<T>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = async (kind: 'pdf' | 'xlsx') => {
    setBusy(kind);
    setError(null);
    try {
      const spec = build();
      if (kind === 'pdf') await exportPdf(spec);
      else await exportExcel(spec);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Izvoz nije uspio');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative inline-block min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 xl:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Izvoz
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-44 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-lg xl:left-auto xl:right-0">
          <button type="button" disabled={!!busy} onClick={() => void run('pdf')} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50">
            <FileText className="h-4 w-4 text-red-500" /> PDF
          </button>
          <button type="button" disabled={!!busy} onClick={() => void run('xlsx')} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel (.xlsx)
          </button>
          {error && <p className="border-t border-slate-100 p-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
