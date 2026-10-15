import type { ReactNode } from 'react';

interface BadgeProps {
  variant: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange';
  children: ReactNode;
}

const variantStyles: Record<BadgeProps['variant'], string> = {
  green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  blue: 'bg-sky-100 text-sky-800 border-sky-200',
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200',
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${variantStyles[variant]}`}
    >
      {children}
    </span>
  );
}
