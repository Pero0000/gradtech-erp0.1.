import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { fetchUgovoreniRadovi, fetchTaskHistoryRecords, fetchOrderHistoryRecords } from '@/lib/api';
import { useRequestScope } from '@/lib/useRequestScope';
import { ContractedWorkChangeHistoryPanel, TaskChangeHistoryPanel, OrderChangeHistoryPanel, OrderTeamChangeHistoryPanel } from './FuelChangeHistory';
import { HistoryButton, HistoryDialog } from './HistoryDialog';

function WorkHistory({ disabled, onRestore, onRestoringChange, refreshVersion, taskHistory = false, orderHistory = false, orderTeamHistory = false, buttonLabel }: {
  disabled: boolean;
  onRestore: () => Promise<void>;
  onRestoringChange: (value: boolean) => void;
  refreshVersion: number;
  taskHistory?: boolean;
  orderHistory?: boolean;
  orderTeamHistory?: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; naziv: string; vrsta?: string; gradilista?: { naziv: string } | null }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRequestScope();
  const load = useCallback(async () => {
    const isCurrent = scope.start();
    setLoading(true);
    setError(null);
    try {
      const records = orderHistory || orderTeamHistory ? await fetchOrderHistoryRecords() : taskHistory ? await fetchTaskHistoryRecords() : await fetchUgovoreniRadovi();
      if (!isCurrent()) return;
      setItems(records);
      setSelectedId((id) => records.some((item) => item.id === id) ? id : '');
    } catch (reason) {
      if (isCurrent()) setError(reason && typeof reason === 'object' && 'message' in reason
        ? String(reason.message) : 'Povijest nije dostupna.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [scope, taskHistory, orderHistory, orderTeamHistory]);

  useEffect(() => {
    if (open) void load();
    return () => scope.invalidate();
  }, [open, refreshVersion, load, scope]);

  const Panel = orderTeamHistory ? OrderTeamChangeHistoryPanel : orderHistory ? OrderChangeHistoryPanel : taskHistory ? TaskChangeHistoryPanel : ContractedWorkChangeHistoryPanel;
  const noun = orderHistory || orderTeamHistory ? 'naloga' : taskHistory ? 'zadataka' : 'radova';
  const title = orderTeamHistory ? 'Povijest dodjele ekipe naloga (30 dana)' : orderHistory ? 'Povijest osnovnih podataka naloga (30 dana)' : taskHistory ? 'Povijest izmjena zadataka i povezanih rokova (30 dana)' : 'Povijest izmjena ugovorenih i VTR radova (30 dana)';
  return <>
    <HistoryButton onClick={() => setOpen(true)} disabled={restoring} ariaLabel={title} label={buttonLabel} />
    <HistoryDialog open={open} onClose={() => setOpen(false)} title={title}>
      <p className="text-xs text-slate-500">{orderHistory || orderTeamHistory ? 'Odaberite nalog. Za povrat zatvorite obrazac naloga.' : <>
        {taskHistory ? 'Odaberite zadatak.' : 'Odaberite rad.'} Za povrat zatvorite obrazac i detalje gradilišta.
      </>} Za obrisani zapis najprije vratite brisanje.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <select aria-label={orderHistory || orderTeamHistory ? 'Nalog za povijest izmjena' : taskHistory ? 'Zadatak za povijest izmjena' : 'Rad za povijest izmjena'} value={selectedId} disabled={disabled || loading || restoring}
          onChange={(event) => setSelectedId(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-300 p-2 text-sm">
          <option value="">{orderHistory || orderTeamHistory ? 'Odaberite radni nalog' : taskHistory ? 'Odaberite zadatak ili dodatni rad' : 'Odaberite ugovoreni ili VTR rad'}</option>
          {items.map((item) => <option key={item.id} value={item.id}>
            {orderHistory || orderTeamHistory ? 'Nalog' : taskHistory ? item.vrsta === 'dodatni' ? 'Dodatni rad' : 'Zadatak' : item.vrsta === 'vtr' ? 'VTR' : 'Ugovoreni'} · {item.naziv} · {item.gradilista?.naziv ?? 'Bez gradilišta'}
          </option>)}
        </select>
        <button type="button" disabled={disabled || loading || restoring} onClick={() => void load()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">{`Osvježi popis ${noun}`}</button>
      </div>
      {loading && <p role="status" className="text-sm text-slate-500">Učitavanje…</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm text-slate-500">{`Nema ${noun} za odabir.`}</p>}
      {selectedId && <Panel recordId={selectedId} disabled={disabled || loading || Boolean(error)}
        onRestoringChange={(value) => { setRestoring(value); onRestoringChange(value); }} onRestore={onRestore} />}
    </HistoryDialog>
  </>;
}

export function ContractedWorkHistory(props: {
  disabled: boolean;
  onRestore: () => Promise<void>;
  onRestoringChange: (value: boolean) => void;
  refreshVersion: number;
  buttonLabel?: string;
}) {
  const { canAccess } = useAuth();
  return canAccess('gradilista', 'edit') ? <WorkHistory {...props} /> : null;
}

export function TaskHistory(props: {
  disabled: boolean;
  onRestore: () => Promise<void>;
  onRestoringChange: (value: boolean) => void;
  refreshVersion: number;
  buttonLabel?: string;
}) {
  const { canAccess } = useAuth();
  return canAccess('gradilista', 'edit') ? <WorkHistory {...props} taskHistory /> : null;
}

export function OrderHistory(props: {
  disabled: boolean;
  onRestore: () => Promise<void>;
  onRestoringChange: (value: boolean) => void;
  refreshVersion: number;
  buttonLabel?: string;
}) {
  const { canAccess } = useAuth();
  return canAccess('radni_nalozi', 'edit') ? <WorkHistory {...props} orderHistory /> : null;
}

export function OrderTeamHistory(props: {
  disabled: boolean;
  onRestore: () => Promise<void>;
  onRestoringChange: (value: boolean) => void;
  refreshVersion: number;
  buttonLabel?: string;
}) {
  const { canAccess } = useAuth();
  return canAccess('radni_nalozi', 'edit') ? <WorkHistory {...props} orderTeamHistory /> : null;
}
