import { CircleAlert } from "lucide-react";

type InlineAlertProps = {
  className?: string;
  detail?: string;
  title: string;
};

export function InlineAlert({ className, detail, title }: InlineAlertProps) {
  const classes = ["inline-alert", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="alert" aria-atomic="true">
      <span className="inline-alert-icon" aria-hidden="true">
        <CircleAlert size={16} />
      </span>
      <span className="inline-alert-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}
