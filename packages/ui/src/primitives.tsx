import { forwardRef, memo, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export const Button = memo(function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "quiet" | "danger";
  size?: "default" | "sm" | "icon";
}) {
  return <button className={clsx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} {...props} />;
});

export const IconButton = memo(function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button className={className} size="icon" variant="ghost" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
});

export const Badge = memo(function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "good" | "warn" | "info" | "premium";
}) {
  return <span className={clsx("ui-badge", `ui-badge--${tone}`, className)} {...props} />;
});

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div className={clsx("ui-segmented", className)} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          aria-selected={value === option.value}
          className="ui-segmented__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Panel(
  { className, ...props },
  ref,
) {
  return <section className={clsx("ui-panel", className)} ref={ref} {...props} />;
});
