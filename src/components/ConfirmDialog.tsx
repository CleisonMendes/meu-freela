import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./dialog.css";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" pinta o botão de confirmação de vermelho (ações destrutivas). */
  tone?: "primary" | "danger";
  /** Só o botão de confirmação (para avisos). */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Pop-up centralizado: Esc ou clique fora cancelam; o foco vai para o botão de confirmar. */
export default function ConfirmDialog({
  open, title, children, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  tone = "primary", hideCancel = false, onConfirm, onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">{title}</h3>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {!hideCancel && <button className="subtle-button dialog-button" onClick={onCancel}>{cancelLabel}</button>}
          <button
            ref={confirmRef}
            className={`${tone === "danger" ? "danger-button" : "primary-button"} dialog-button`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}