import { X } from "lucide-react";

export type ActionDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  inputLabel?: string;
  requiredText?: string;
};

type ActionDialogProps = {
  dialog: ActionDialogState;
  inputValue: string;
  onInputChange: (value: string) => void;
  onClose: (accepted: boolean) => void;
};

export default function ActionDialog({
  dialog,
  inputValue,
  onInputChange,
  onClose
}: ActionDialogProps) {
  return (
    <div className="modal-backdrop action-dialog-backdrop" role="presentation">
      <section
        className="modal-card action-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="action-dialog-title">{dialog.title}</h2>
            <p className="subtle action-dialog-message">{dialog.message}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={() => onClose(false)}
          >
            <X />
          </button>
        </div>
        {dialog.inputLabel && (
          <label className="action-dialog-input">
            {dialog.inputLabel}
            <input
              autoFocus
              value={inputValue}
              onChange={event => onInputChange(event.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${dialog.danger ? "danger" : "primary"}`}
            disabled={!!dialog.requiredText && inputValue !== dialog.requiredText}
            onClick={() => onClose(true)}
          >
            {dialog.confirmLabel ?? "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
