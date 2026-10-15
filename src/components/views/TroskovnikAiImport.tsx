import { useRef, useState } from 'react';
import { Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Select, TextInput } from '@/components/ui/Field';
import { parseTroskovnik, MAX_FILE_MB, type TroskovnikRedak } from '@/lib/aiTroskovnik';
import { createPonuda, replacePonudaStavke, updatePonuda, type Ponuda, type PonudaStavka } from '@/lib/ponude';
import { getAiKey } from '@/lib/ai';

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');

interface Props {
  open: boolean;
  onClose: () => void;
  gradilisteId: string;
  naziv?: string;
  ponude: { ponuda: Ponuda; stavke: PonudaStavka[] }[];
  onImported: () => void;
}

export function TroskovnikAiImport({ open, onClose, gradilisteId, naziv, ponude, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<TroskovnikRedak[] | null>(null);
  const [target, setTarget] = useState('new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setRows(null);
    setProgress(0);
    setError(null);
    setTarget('new');
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => {
    if (busy || saving) return;
    reset();
    onClose();
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const result = await parseTroskovnik(file, setProgress);
      if (result.length === 0) setError('AI nije pronašao stavke u dokumentu.');
      else setRows(result);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<TroskovnikRedak>) => setRows((r) => (r ? r.map((x, j) => (j === i ? { ...x, ...p } : x)) : r));
  const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;

  const save = async () => {
    if (!rows?.length) return;
    setSaving(true);
    setError(null);
    try {
      const existing = ponude.find((p) => p.ponuda.id === target);
      let ponudaId: string;
      let prije: PonudaStavka[] = [];
      if (existing) {
        ponudaId = existing.ponuda.id;
        prije = existing.stavke;
      } else {
        const created = await createPonuda({
          naslov: naziv ? `Troškovnik – ${naziv}` : 'Uvezeni troškovnik',
          investitor_id: null,
          objekt_id: null,
          adresa_radova: null,
          datum: new Date().toISOString().slice(0, 10),
          status: 'potvrdena',
          popust: 0,
          pdv: 25,
          prikazi_popust: false,
          prijenos_porezne_obveze: false,
          napomene: null,
        });
        ponudaId = created.id;
        await updatePonuda(ponudaId, { gradiliste_id: gradilisteId });
      }
      const old = prije.map((s) => ({
        stavka_id: s.stavka_id, redoslijed: 0, opis: s.opis, vrsta_posla: s.vrsta_posla, podgrupa: s.podgrupa,
        jedinica: s.jedinica, kolicina: s.kolicina, cijena: s.cijena, popust: s.popust,
      }));
      const added = rows.map((r) => ({
        stavka_id: null, redoslijed: 0, opis: r.opis.trim(), vrsta_posla: r.grupa.trim() || null, podgrupa: null,
        jedinica: r.jedinica.trim() || 'kom', kolicina: r.kolicina, cijena: r.cijena, popust: 0,
      }));
      await replacePonudaStavke(ponudaId, [...old, ...added]);
      reset();
      onImported();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const total = (rows ?? []).reduce((s, r) => s + r.kolicina * r.cijena, 0);

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title="Učitaj troškovnik pomoću AI-a"
      footer={
        <>
          <button onClick={close} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
          {rows ? (
            <button onClick={() => void save()} disabled={saving || rows.length === 0} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? 'Spremanje…' : `Spremi ${rows.length} stavki`}
            </button>
          ) : (
            <button onClick={() => void analyze()} disabled={!file || busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? `Čitam… (${progress} stavki)` : 'Analiziraj'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!getAiKey() && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Gemini API ključ nije postavljen. Upiši ga u Postavke.</p>}

        {!rows ? (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-slate-500 hover:border-sky-400 hover:text-sky-600"
            >
              <Upload className="h-7 w-7" />
              <span className="text-sm font-medium">{file ? file.name : 'Odaberi troškovnik (PDF, slika, CSV ili TXT)'}</span>
              <span className="text-xs text-slate-400">do {MAX_FILE_MB} MB · Excel prvo spremi kao PDF ili CSV</span>
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.tsv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-slate-400">Veliki troškovnici čitaju se u serijama, pa može potrajati nekoliko minuta. Prije spremanja možeš pregledati i ispraviti svaku stavku.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-600">Spremi u:</span>
              <div className="w-72">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="new">Nova ponuda / troškovnik</option>
                  {ponude.map((p) => <option key={p.ponuda.id} value={p.ponuda.id}>Dodaj u {p.ponuda.redni_broj}/{p.ponuda.godina} · {p.ponuda.naslov}</option>)}
                </Select>
              </div>
              <span className="ml-auto text-slate-500">Vrijednost: <b className="text-slate-800">{eur(total)}</b></span>
            </div>
            <p className="text-xs text-slate-400">Cijene koje nisu u dokumentu su 0; ispuni ih ili ih kasnije uredi u tabu Ponude.</p>
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Grupa</th><th className="px-2 py-2">Opis</th><th className="px-2 py-2 w-16">Jed.</th>
                    <th className="px-2 py-2 w-20">Kol.</th><th className="px-2 py-2 w-24">Cijena</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-1 py-1"><TextInput value={r.grupa} onChange={(e) => patch(i, { grupa: e.target.value })} /></td>
                      <td className="px-1 py-1"><TextInput value={r.opis} onChange={(e) => patch(i, { opis: e.target.value })} /></td>
                      <td className="px-1 py-1"><TextInput value={r.jedinica} onChange={(e) => patch(i, { jedinica: e.target.value })} /></td>
                      <td className="px-1 py-1"><TextInput type="number" step="0.01" value={String(r.kolicina)} onChange={(e) => patch(i, { kolicina: num(e.target.value) })} /></td>
                      <td className="px-1 py-1"><TextInput type="number" step="0.01" value={String(r.cijena)} onChange={(e) => patch(i, { cijena: num(e.target.value) })} /></td>
                      <td className="px-1 py-2"><button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={reset} className="text-xs text-sky-600 hover:underline">Učitaj drugu datoteku</button>
          </>
        )}
      </div>
    </Modal>
  );
}
