import { memo } from "react";
import { Bell, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { Toast } from "./useToast";

export const ToastContainer = memo(function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const role = toast.tone === "error" ? "alert" : "status";
        const Icon = toast.tone === "success" ? CircleCheck : toast.tone === "error" ? CircleAlert : toast.tone === "warning" ? TriangleAlert : Bell;

        return (
          <div className={`toast toast--${toast.tone}`} key={toast.id} role={role}>
            <span className="toast-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
});
