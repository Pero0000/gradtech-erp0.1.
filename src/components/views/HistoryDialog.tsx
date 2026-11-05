import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { History } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface HistoryMenuRegistration {
  content: ReactNode;
  disabled: boolean;
}

interface HistoryActionRegistration {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

interface HistoryToolbarContextValue {
  available: boolean;
  disabled: boolean;
  open: () => void;
  register: (owner: object, registration: HistoryMenuRegistration) => void;
  unregister: (owner: object) => void;
  registerAction: (owner: object, registration: HistoryActionRegistration) => void;
  unregisterAction: (owner: object) => void;
}

const HistoryToolbarContext = createContext<HistoryToolbarContextValue | null>(null);
const LocalHistoryButtonContext = createContext(false);

export function HistoryButton({ onClick, disabled = false, ariaLabel = 'Povijest', label = 'Povijest' }: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  label?: string;
}) {
  const toolbar = useContext(HistoryToolbarContext);
  const localButton = useContext(LocalHistoryButtonContext);
  const owner = useRef<object>({});
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const handleClick = useCallback(() => onClickRef.current(), []);
  const actionLabel = ariaLabel === 'Povijest' ? label : ariaLabel;
  const registerAction = toolbar?.registerAction;
  const unregisterAction = toolbar?.unregisterAction;

  useEffect(() => {
    if (!registerAction || !unregisterAction || localButton) return;
    const actionOwner = owner.current;
    registerAction(actionOwner, { label: actionLabel, disabled, onClick: handleClick });
    return () => unregisterAction(actionOwner);
  }, [registerAction, unregisterAction, localButton, actionLabel, disabled, handleClick]);

  if (toolbar && !localButton) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      <History className="h-4 w-4" />
      {label}
    </button>
  );
}

export function HistoryToolbarProvider({ children }: { children: ReactNode }) {
  const menuRef = useRef<{ owner: object; registration: HistoryMenuRegistration } | null>(null);
  const actionsRef = useRef(new Map<object, HistoryActionRegistration>());
  const [available, setAvailable] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setActionsVersion] = useState(0);

  const register = useCallback((owner: object, registration: HistoryMenuRegistration) => {
    menuRef.current = { owner, registration };
    setAvailable(true);
    setDisabled(registration.disabled);
  }, []);

  const unregister = useCallback((owner: object) => {
    if (menuRef.current?.owner !== owner) return;
    menuRef.current = null;
    setAvailable(false);
    setDisabled(false);
    setOpen(false);
  }, []);

  const registerAction = useCallback((owner: object, registration: HistoryActionRegistration) => {
    actionsRef.current.set(owner, registration);
    setActionsVersion((version) => version + 1);
  }, []);

  const unregisterAction = useCallback((owner: object) => {
    if (!actionsRef.current.delete(owner)) return;
    setActionsVersion((version) => version + 1);
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hasActions = actionsRef.current.size > 0;
  const value = useMemo(() => ({
    available: available || hasActions,
    disabled: disabled && !hasActions,
    open: show,
    register,
    unregister,
    registerAction,
    unregisterAction,
  }), [available, disabled, hasActions, show, register, unregister, registerAction, unregisterAction]);
  const actions = [...actionsRef.current.entries()];

  return (
    <HistoryToolbarContext.Provider value={value}>
      {children}
      <HistoryDialog open={open && value.available} onClose={() => setOpen(false)} title="Povijest">
        {menuRef.current && (
          <LocalHistoryButtonContext.Provider value>
            <div className="flex flex-wrap gap-2">{menuRef.current.registration.content}</div>
          </LocalHistoryButtonContext.Provider>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map(([, action], index) => (
              <button
                key={index}
                type="button"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <History className="h-4 w-4" />
                {action.label}
              </button>
            ))}
          </div>
        )}
      </HistoryDialog>
    </HistoryToolbarContext.Provider>
  );
}

export function HistoryToolbarAction() {
  const toolbar = useContext(HistoryToolbarContext);
  if (!toolbar?.available) return null;
  return (
    <LocalHistoryButtonContext.Provider value>
      <HistoryButton onClick={toolbar.open} disabled={toolbar.disabled} />
    </LocalHistoryButtonContext.Provider>
  );
}

export function HistoryMenu({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const toolbar = useContext(HistoryToolbarContext);
  const owner = useRef<object>({});
  const [open, setOpen] = useState(false);
  const register = toolbar?.register;
  const unregister = toolbar?.unregister;

  useEffect(() => {
    if (!register) return;
    register(owner.current, { content: children, disabled });
  }, [register, children, disabled]);

  useEffect(() => {
    if (!unregister) return;
    const menuOwner = owner.current;
    return () => unregister(menuOwner);
  }, [unregister]);

  if (toolbar) return null;

  return (
    <>
      <HistoryButton onClick={() => setOpen(true)} disabled={disabled} />
      <HistoryDialog open={open} onClose={() => setOpen(false)} title="Povijest">
        <div className="flex flex-wrap gap-2">{children}</div>
      </HistoryDialog>
    </>
  );
}

export function HistoryDialog({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title} wide="md">
      <div className="space-y-3">{children}</div>
    </Modal>
  );
}
