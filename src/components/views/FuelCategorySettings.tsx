import { useEffect, useState } from 'react';
import { ChevronDown, Save } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import {
  fetchRadnikKategorijeGorivo,
  fetchRadnikGorivoVehicleTypes,
  updateRadnikKategorijaGorivoTypes,
  type RadnikKategorijaGorivo,
} from '@/lib/api';
import { Select } from '@/components/ui/Field';

export function FuelCategorySettings() {
  const { canAccess } = useAuth();
  const canView = canAccess('radnici', 'view');
  const canEdit = canAccess('radnici', 'edit');
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<RadnikKategorijaGorivo[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open || !canView) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    void Promise.all([fetchRadnikKategorijeGorivo(), fetchRadnikGorivoVehicleTypes()])
      .then(([nextCategories, nextTypes]) => {
        if (!active) return;
        const category = nextCategories[0];
        setCategories(nextCategories);
        setVehicleTypes(nextTypes);
        setSelectedCategory(category?.naziv ?? '');
        setRestricted(Boolean(category?.dozvoljeni_tipovi_vozila));
        setSelectedTypes(category?.dozvoljeni_tipovi_vozila ?? nextTypes);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju postavki goriva.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, canView, retry]);

  const selectCategory = (name: string) => {
    const category = categories.find((item) => item.naziv === name);
    setSelectedCategory(name);
    setRestricted(Boolean(category?.dozvoljeni_tipovi_vozila));
    setSelectedTypes(category?.dozvoljeni_tipovi_vozila ?? vehicleTypes);
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (!canEdit || saving) return;
    if (!selectedCategory || (restricted && selectedTypes.length === 0)) {
      setError('Odaberite kategoriju i barem jedan tip vozila ili isključite ograničenje.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const allowedTypes = restricted ? selectedTypes : null;
      await updateRadnikKategorijaGorivoTypes(selectedCategory, allowedTypes);
      setCategories((current) => current.map((category) => category.naziv === selectedCategory
        ? { ...category, dozvoljeni_tipovi_vozila: allowedTypes }
        : category));
      setNotice('Dopušteni tipovi vozila su spremljeni.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri spremanju postavki goriva.');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) return null;

  return (
    <details className="group mb-4 text-sm" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        Ograničenja točenja goriva
      </summary>
      {open && (
        <div className="mt-2 max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
          <div>
            <h2 className="font-semibold text-slate-900">Dopušteni tipovi vozila za gorivo</h2>
            <p className="mt-1 text-xs text-slate-500">Ograničenja po kategoriji djelatnika primjenjuju se na mobilni i uredski unos goriva.</p>
          </div>
          {loading ? <p className="text-xs text-slate-500">Učitavanje postavki…</p> : (
            <>
              {categories.length === 0 ? <p className="text-xs text-slate-500">Nema kategorija djelatnika.</p> : (
                <>
                  <label className="block text-xs font-medium text-slate-700">
                    Kategorija
                    <Select value={selectedCategory} disabled={saving} onChange={(event) => selectCategory(event.target.value)} className="mt-1">
                      {categories.map((category) => <option key={category.naziv} value={category.naziv}>{category.naziv}</option>)}
                    </Select>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={restricted} disabled={!canEdit || saving || vehicleTypes.length === 0}
                      onChange={(event) => { setRestricted(event.target.checked); setError(null); setNotice(null); }}
                      className="h-4 w-4 rounded border-slate-300" />
                    Ograničiti ovu kategoriju na odabrane tipove vozila
                  </label>
                  {restricted ? (
                    vehicleTypes.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {vehicleTypes.map((tip) => (
                          <label key={tip} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700">
                            <input type="checkbox" disabled={!canEdit || saving}
                              checked={selectedTypes.some((selected) => selected.trim().toLowerCase() === tip.trim().toLowerCase())}
                              onChange={(event) => {
                                setSelectedTypes((current) => event.target.checked ? [...current, tip]
                                  : current.filter((selected) => selected.trim().toLowerCase() !== tip.trim().toLowerCase()));
                                setError(null);
                                setNotice(null);
                              }}
                              className="h-4 w-4 rounded border-slate-300" />
                            {tip}
                          </label>
                        ))}
                      </div>
                    ) : <p className="text-xs text-amber-700">Najprije dodajte tip vozila u modulu Vozila.</p>
                  ) : <p className="text-xs text-slate-500">Bez ograničenja: kategorija može odabrati sve tipove vozila.</p>}
                  {canEdit ? (
                    <button type="button" onClick={() => void save()} disabled={saving || (restricted && selectedTypes.length === 0)}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                      <Save className="h-3.5 w-3.5" />
                      {saving ? 'Spremanje…' : 'Spremi ograničenje'}
                    </button>
                  ) : <p className="text-xs text-slate-500">Za promjenu je potrebna dozvola za uređivanje djelatnika.</p>}
                </>
              )}
              {error && <div className="space-y-2">
                <p role="alert" className="text-xs text-red-700">{error}</p>
                <button type="button" disabled={saving} onClick={() => setRetry((current) => current + 1)}
                  className="text-xs font-medium text-sky-700 hover:underline disabled:opacity-50">Ponovno učitaj postavke</button>
              </div>}
              {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
            </>
          )}
        </div>
      )}
    </details>
  );
}
