// Overlay + modal shell. Clicking the backdrop or the × closes it.
export default function Modal({ onClose, children }) {
  return (
    <div
      className="ovl"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <button className="x" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
