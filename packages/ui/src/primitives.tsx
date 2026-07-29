import { forwardRef, memo, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export const Button = memo(function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "quiet" | "danger";
  size?: "default" | "sm" | "icon";
}) {
  return <button className={clsx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} type={type} {...props} />;
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
    <Button className={className} size="icon" variant="ghost" {...props} aria-label={label} title={props.title ?? label}>
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
  label: string;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (options.length === 0) return;

    let nextIndex: number | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % options.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }

    if (nextIndex === undefined) return;

    event.preventDefault();
    onChange(options[nextIndex].value);
    const nextTab = event.currentTarget.parentElement?.children.item(nextIndex) as HTMLElement | null;
    nextTab?.focus();
  }

  return (
    <div aria-label={label} aria-orientation="horizontal" className={clsx("ui-segmented", className)} role="tablist">
      {options.map((option, index) => (
        <button
          aria-selected={value === option.value}
          className="ui-segmented__item"
          key={option.value}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onClick={() => onChange(option.value)}
          role="tab"
          tabIndex={index === tabbableIndex ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Panel({ className, ...props }, ref) {
  return <section className={clsx("ui-panel", className)} ref={ref} {...props} />;
});
