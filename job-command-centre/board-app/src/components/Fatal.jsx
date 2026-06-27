export default function Fatal({ message }) {
  return (
    <div className="center">
      <div>
        <h1>⚠</h1>
        <p>{message}</p>
      </div>
    </div>
  );
}
