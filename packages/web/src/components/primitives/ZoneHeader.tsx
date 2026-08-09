import type { ReactNode } from "react";

export function ZoneHeader({
  title,
  subtitle,
  control,
}: {
  title: string;
  subtitle?: string;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-3">
      <div>
        <h1 className="text-[20px] font-bold tracking-[0.5px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[12px] text-text-dim">{subtitle}</p>}
      </div>
      {control}
    </div>
  );
}
