import { useEffect, useMemo, useState } from 'react';
import { FileSignature, Sparkles } from 'lucide-react';
import { TroskovnikAiImport } from './TroskovnikAiImport';
import { supabase } from '@/lib/supabase';
import { ponudaBroj, ponudaUkupno, stavkaPopust, type Ponuda, type PonudaStavka } from '@/lib/ponude';

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const n2 = (v: number) => v.toLocaleString('hr-HR', { maximumFractionDigits: 2 });

// Troškovnik iz ponude koja je pretvorena u ovo gradilište (ništa se ne prikazuje ako ponude nema)
export function GradilisteTroskovnik({ gradilisteId, naziv }: { gradilisteId: string; naziv?: string }) {
  const [ponude, setPonude] = useState<{ ponuda: Ponuda; stavke: PonudaStavka[] }[]>([]);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: p, error } = await supabase.from('ponude').select('*').eq('gradiliste_id', gradilisteId);
      if (error || !p?.length) {
        if (active) setPonude([]);
        return;
      }
      const { data: s } = await supabase.from('ponude_stavke').select('*').in('ponuda_id', p.map((x) => x.id)).order('redoslijed');
      const stavke = (s ?? []) as PonudaStavka[];
      if (active) setPonude((p as Ponuda[]).map((ponuda) => ({ ponuda, stavke: stavke.filter((x) => x.ponuda_id === ponuda.id) })));
    })().catch(() => undefined);
    return () => { active = false; };
  }, [gradilisteId, reloadKey]);

  const groups = useMemo(
    () => ponude.map(({ ponuda, stavke }) => {
      const map = new Map<string, PonudaStavka[]>();
      stavke.forEach((s) => {
        const k = s.vrsta_posla?.trim() || 'Ostalo';
        map.set(k, [...(map.get(k) ?? []), s]);
      });
      return { ponuda, tot: ponudaUkupno(ponuda, stavke), groups: [...map.entries()], count: stavke.length };
    }),
    [ponude],
  );

  const importModal = (
    <TroskovnikAiImport
      open={importOpen}
      onClose={() => setImportOpen(false)}
      gradilisteId={gradilisteId}
      naziv={naziv}
      ponude={ponude}
      onImported={() => setReloadKey((k) => k + 1)}
    />
  );

  if (groups.length === 0) {
    return (
      <section className="border-t border-slate-200 py-4">
        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-sky-400 hover:text-sky-600">
          <Sparkles className="h-4 w-4" /> Učitaj troškovnik pomoću AI-a
        </button>
        {importModal}
      </section>
    );
  }

  return (
    <section className="border-t border-slate-200 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileSignature className="h-4 w-4" /> Troškovnik iz ponude</h3>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"><Sparkles className="h-3.5 w-3.5" /> Učitaj AI-em</button>
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-sky-600 hover:underline">{open ? 'Sažmi' : 'Prikaži stavke'}</button>
        </div>
      </div>
      {importModal}
      {groups.map(({ ponuda, tot, groups: gr, count }) => (
        <div key={ponuda.id} className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-800">Ponuda {ponudaBroj(ponuda)} · {ponuda.naslov}</p>
            <span className="text-slate-400">{count} stavki</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div><p className="text-slate-400">Bez PDV-a</p><p className="font-semibold text-slate-800">{eur(tot.neto)}</p></div>
            <div><p className="text-slate-400">PDV</p><p className="font-semibold text-slate-800">{ponuda.prijenos_porezne_obveze ? 'prijenos' : eur(tot.pdv)}</p></div>
            <div><p className="text-slate-400">Ukupno</p><p className="font-semibold text-slate-800">{eur(tot.bruto)}</p></div>
          </div>
          {open && (
            <div className="mt-3 space-y-3">
              {gr.map(([vrsta, list]) => (
                <div key={vrsta}>
                  <p className="mb-1 font-semibold text-orange-700">{vrsta}</p>
                  <table className="w-full">
                    <tbody>
                      {list.map((s) => {
                        const pop = ponuda.prikazi_popust === false ? 0 : stavkaPopust(s, ponuda.popust);
                        return (
                          <tr key={s.id} className="border-t border-slate-200 align-top">
                            <td className="py-1 pr-2 text-slate-700">{s.opis}</td>
                            <td className="whitespace-nowrap py-1 pr-2 text-right text-slate-500">{n2(s.kolicina)} {s.jedinica}</td>
                            <td className="whitespace-nowrap py-1 text-right font-medium text-slate-800">{eur(s.kolicina * s.cijena * (1 - pop / 100))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
