import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Download, FileText, Hammer, Package, Plus, Trash2, Wrench } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { downloadFile } from '@/lib/downloadFile';
import {
  addGradilisteStavka,
  deleteGradilisteDokument,
  deleteNalogStavka,
  fetchGradilisteDokumenti,
  fetchGradilisteStavke,
  updateNalogStavka,
  uploadGradilisteDokument,
  type GradilisteDokument,
  type GradilisteStavka,
} from '@/lib/api';

const MIGRATION_HINT = ' Pokreni migraciju 20261015290000_gradiliste_materijal_dokumenti.sql u Supabase SQL editoru.';

function errText(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'message' in reason) return String((reason as { message: unknown }).message);
  return fallback;
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function SectionBox({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 py-4">
      <h3 className="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="inline-flex items-center gap-2 rounded-md bg-sky-50 px-2.5 py-1.5 text-sky-900">
          <span className="text-sky-700">{icon}</span>
          {title}
        </span>
      </h3>
      {children}
    </section>
  );
}

function StavkeList({
  items,
  placeholder,
  onAdd,
  onToggle,
  onRemove,
}: {
  items: GradilisteStavka[];
  placeholder: string;
  onAdd?: (naziv: string) => void;
  onToggle: (s: GradilisteStavka) => void;
  onRemove: (s: GradilisteStavka) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim() || !onAdd) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-xs text-slate-400">Nema stavki.</p>}
        {items.map((s) => (
          <div key={s.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${s.gotovo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
            <input type="checkbox" checked={s.gotovo} onChange={() => onToggle(s)} className="h-4 w-4 flex-shrink-0 accent-emerald-600" title="Označi kao riješeno" />
            <span className={`min-w-0 flex-1 break-words ${s.gotovo ? 'font-medium text-emerald-800 line-through decoration-emerald-400' : 'text-slate-800'}`}>{s.naziv}</span>
            {s.tip === 'stroj' && s.sati ? <span className="flex-shrink-0 text-[10px] text-slate-500">{s.sati} h</span> : null}
            <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] ${s.nalog_id ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
              {s.nalog_id ? 'na nalogu' : 'čeka nalog'}
            </span>
            <button type="button" onClick={() => onRemove(s)} className="flex-shrink-0 text-slate-300 hover:text-red-600" aria-label="Obriši stavku">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {onAdd && <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs xl:flex-1"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj
        </button>
      </div>}
    </div>
  );
}

export function GradilisteMaterijalDokumenti({ gradilisteId }: { gradilisteId: string }) {
  const [stavke, setStavke] = useState<GradilisteStavka[]>([]);
  const [dokumenti, setDokumenti] = useState<GradilisteDokument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [downloadingPhotoId, setDownloadingPhotoId] = useState<string | null>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    const [st, dok] = await Promise.allSettled([fetchGradilisteStavke(gradilisteId), fetchGradilisteDokumenti(gradilisteId)]);
    if (st.status === 'fulfilled') setStavke(st.value);
    else setError(errText(st.reason, 'Greška pri učitavanju materijala i alata.') + MIGRATION_HINT);
    if (dok.status === 'fulfilled') setDokumenti(dok.value);
    else setError((e) => e ?? errText(dok.reason, 'Greška pri učitavanju dokumenata.') + MIGRATION_HINT);
  }, [gradilisteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const list = await fetchGradilisteStavke(gradilisteId);
        if (!cancelled) setStavke(list);
      } catch (reason) {
        if (!cancelled) setError(errText(reason, 'Greška pri osvježavanju materijala i alata gradilišta.'));
      }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [gradilisteId]);

  const guard = async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errText(reason, fallback));
    }
  };

  const addStavka = (tip: 'materijal' | 'alat', naziv: string) =>
    void guard(async () => {
      await addGradilisteStavka(gradilisteId, tip, naziv);
      setStavke(await fetchGradilisteStavke(gradilisteId));
    }, 'Greška pri dodavanju stavke.');

  const toggleStavka = (s: GradilisteStavka) => {
    setStavke((prev) => prev.map((x) => (x.id === s.id ? { ...x, gotovo: !s.gotovo } : x)));
    void guard(() => updateNalogStavka(s.id, { gotovo: !s.gotovo }), 'Greška pri spremanju stavke.');
  };

  const removeStavka = (s: GradilisteStavka) =>
    void guard(async () => {
      await deleteNalogStavka(s.id);
      setStavke((prev) => prev.filter((x) => x.id !== s.id));
    }, 'Greška pri brisanju stavke.');

  const upload = async (files: FileList | null, vrsta: 'dokument' | 'slika') => {
    if (!files || files.length === 0) return;
    setUploading(true);
    await guard(async () => {
      for (const file of Array.from(files)) await uploadGradilisteDokument(gradilisteId, file, vrsta);
      setDokumenti(await fetchGradilisteDokumenti(gradilisteId));
    }, 'Greška pri učitavanju datoteke.');
    setUploading(false);
    if (docRef.current) docRef.current.value = '';
    if (imgRef.current) imgRef.current.value = '';
  };

  const removeDokument = (d: GradilisteDokument) => {
    if (!window.confirm(`Obrisati „${d.naziv}”?`)) return;
    void guard(async () => {
      await deleteGradilisteDokument(d);
      setDokumenti((prev) => prev.filter((x) => x.id !== d.id));
    }, 'Greška pri brisanju datoteke.');
  };

  const materijal = stavke.filter((s) => s.tip === 'materijal');
  const alat = stavke.filter((s) => s.tip === 'alat');
  const strojevi = stavke.filter((s) => s.tip === 'stroj');
  const docs = dokumenti.filter((d) => d.vrsta === 'dokument');
  const slike = dokumenti.filter((d) => d.vrsta === 'slika');
  const activePhotoIndex = slike.findIndex((photo) => photo.id === activePhotoId);
  const activePhoto = slike[activePhotoIndex];
  const downloadPhoto = async (photo: GradilisteDokument) => {
    if (downloadingPhotoId) return;
    setDownloadingPhotoId(photo.id);
    await guard(() => downloadFile(photo.url, photo.naziv), 'Greška pri preuzimanju slike.');
    setDownloadingPhotoId(null);
  };

  return (
    <>
      {error && <p className="my-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid min-w-0 gap-x-6 xl:grid-cols-2">
        <SectionBox title={`Materijal (${materijal.filter((s) => s.gotovo).length}/${materijal.length})`} icon={<Package className="h-4 w-4" />}>
          <StavkeList items={materijal} placeholder="npr. boja bijela 15 l" onAdd={(n) => addStavka('materijal', n)} onToggle={toggleStavka} onRemove={removeStavka} />
        </SectionBox>
        <SectionBox title={`Alat (${alat.filter((s) => s.gotovo).length}/${alat.length})`} icon={<Hammer className="h-4 w-4" />}>
          <StavkeList items={alat} placeholder="npr. skela, brusilica" onAdd={(n) => addStavka('alat', n)} onToggle={toggleStavka} onRemove={removeStavka} />
        </SectionBox>
        <SectionBox title={`Strojevi (${strojevi.filter((s) => s.gotovo).length}/${strojevi.length})`} icon={<Wrench className="h-4 w-4" />}>
          <StavkeList items={strojevi} placeholder="" onToggle={toggleStavka} onRemove={removeStavka} />
          <p className="mt-2 text-[11px] text-slate-500">Strojevi se dodaju na radni nalog iz popisa strojeva; radni sati × cijena sata ulaze u trošak gradilišta.</p>
        </SectionBox>
      </div>
      <p className="-mt-2 mb-1 text-[11px] text-slate-500">Materijal i alat s oznakom „čeka nalog” automatski ulaze u idući radni nalog ovog gradilišta.</p>

      <div className="grid min-w-0 gap-x-6 xl:grid-cols-2">
        <SectionBox title={`Dokumenti (${docs.length})`} icon={<FileText className="h-4 w-4" />}>
          <input ref={docRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files, 'dokument')} />
          <div className="mb-2 space-y-1.5">
            {docs.length === 0 && <p className="text-xs text-slate-400">Nema dokumenata.</p>}
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs">
                <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <a href={d.url} target="_blank" rel="noreferrer" download={d.naziv} className="min-w-0 flex-1 truncate text-sky-700 hover:underline">{d.naziv}</a>
                <span className="flex-shrink-0 text-[10px] text-slate-400">{formatSize(d.velicina)}</span>
                <button type="button" onClick={() => removeDokument(d)} className="flex-shrink-0 text-slate-300 hover:text-red-600" aria-label="Obriši dokument">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => docRef.current?.click()}
            disabled={uploading}
            className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {uploading ? 'Učitavanje…' : 'Dodaj dokumente (PDF, Excel, Word…)'}
          </button>
        </SectionBox>

        <SectionBox title={`Slike (${slike.length})`} icon={<Camera className="h-4 w-4" />}>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void upload(e.target.files, 'slika')} />
          {slike.length > 0 && (
            <div className="mb-2 grid max-h-[34rem] auto-rows-[11rem] grid-cols-1 gap-2 overflow-y-auto xl:grid-cols-2 2xl:grid-cols-3 overscroll-contain" tabIndex={0} role="region" aria-label="Slike gradilišta — pomaknite za ostale slike">
              {slike.map((d) => (
                <div key={d.id} className="group relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200">
                  <button type="button" onClick={() => setActivePhotoId(d.id)} className="block min-h-0 w-full flex-1 bg-slate-50" aria-label={`Pregledaj ${d.naziv}`}>
                    <img loading="lazy" src={d.url} alt={d.naziv} className="h-full w-full object-contain" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadPhoto(d)}
                    disabled={downloadingPhotoId !== null}
                    className="inline-flex w-full shrink-0 items-center justify-center gap-1 border-t border-slate-100 px-2 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    aria-label={`Preuzmi ${d.naziv}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingPhotoId === d.id ? 'Preuzimanje…' : 'Preuzmi'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDokument(d)}
                    className="absolute right-1 top-1 rounded bg-white/90 p-1 text-red-600"
                    aria-label="Obriši sliku"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {slike.length === 0 && <p className="mb-2 text-xs text-slate-400">Nema slika.</p>}
          <button
            type="button"
            onClick={() => imgRef.current?.click()}
            disabled={uploading}
            className="inline-flex max-w-full items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {uploading ? 'Učitavanje…' : 'Dodaj slike'}
          </button>
        </SectionBox>
      </div>
      <Modal
        open={Boolean(activePhoto)}
        onClose={() => setActivePhotoId(null)}
        title={`Slika ${activePhotoIndex + 1} od ${slike.length}`}
        wide="screen"
      >
        {activePhoto && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setActivePhotoId(slike[(activePhotoIndex - 1 + slike.length) % slike.length].id)} className="flex-shrink-0 rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Prethodna slika">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{activePhoto.naziv}</p>
              <button type="button" onClick={() => setActivePhotoId(slike[(activePhotoIndex + 1) % slike.length].id)} className="flex-shrink-0 rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Sljedeća slika">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <img src={activePhoto.url} alt={activePhoto.naziv} className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />
            <div className="flex justify-end">
              <button type="button" onClick={() => void downloadPhoto(activePhoto)} disabled={downloadingPhotoId !== null} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                <Download className="h-4 w-4" />
                {downloadingPhotoId ? 'Preuzimanje…' : 'Preuzmi ovu sliku'}
              </button>
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
