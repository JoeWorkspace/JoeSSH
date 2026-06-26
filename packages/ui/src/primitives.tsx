import {
  forwardRef,
  memo,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export const Button = memo(function Button({
  className,
  type = "button",
  variant = "default",
  size = "default",
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
  options: Array<{ value: T; label: string; shortLabel?: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function moveToOption(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const option = options[index];
    if (!option) {
      return;
    }

    event.preventDefault();
    onChange(option.value);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (options.length === 0) {
      return;
    }

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        moveToOption(event, (index + 1) % options.length);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        moveToOption(event, (index - 1 + options.length) % options.length);
        break;
      case "Home":
        moveToOption(event, 0);
        break;
      case "End":
        moveToOption(event, options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className={clsx("ui-segmented", className)} role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button
          aria-label={option.label}
          aria-selected={value === option.value}
          className="ui-segmented__item"
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          role="tab"
          tabIndex={index === selectedIndex ? 0 : -1}
          title={option.label}
          type="button"
        >
          {option.icon ? <span className="ui-segmented__icon" aria-hidden="true">{option.icon}</span> : null}
          <span className="ui-segmented__label">{option.shortLabel ?? option.label}</span>
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
