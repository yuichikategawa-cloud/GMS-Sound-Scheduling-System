import type { FormEvent } from "react";
import { X } from "lucide-react";

type AddServantDialogProps = {
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
};

/** Servants-owned dialog for creating a new servant directory record. */
export default function AddServantDialog({ onClose, onSave }: AddServantDialogProps) {
  return (
    <div className="modal-backdrop">
      <form className="modal-card compact" onSubmit={onSave}>
        <div className="modal-head">
          <h2>Add servant</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Full name
          <input name="full_name" required autoFocus placeholder="Servant's full name" />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn primary">Add person</button>
        </div>
      </form>
    </div>
  );
}
