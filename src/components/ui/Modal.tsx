import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean | 'md' | 'screen';
  headerSlotId?: string;
}

export function Modal({ open, onClose, title, children, footer, wide, headerSlotId }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex min-w-0 items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative z-10 flex min-h-0 min-w-0 w-full flex-col ${wide === 'screen' ? 'max-w-[min(96vw,1600px)]' : wide === 'md' ? 'max-w-4xl' : wide ? 'max-w-7xl' : 'max-w-lg'} ${wide === 'screen' ? 'max-h-[96dvh]' : 'max-h-[92dvh]'} rounded-2xl bg-white shadow-2xl`}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-slate-900">{title}</h2>
          {headerSlotId && <div id={headerSlotId} className="order-last flex w-full min-w-0 flex-wrap gap-2 xl:order-none xl:ml-auto xl:mr-3 xl:w-auto" />}
          <button
            onClick={onClose}
            aria-label="Zatvori prozor"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto break-words px-3 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer && <div className="flex max-h-[35dvh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-slate-200 px-3 py-3 sm:px-6 xl:flex-row xl:flex-wrap xl:justify-end xl:py-4">{footer}</div>}
      </div>
    </div>
  );
}
