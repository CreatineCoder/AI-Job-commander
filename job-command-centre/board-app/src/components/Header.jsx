export default function Header({ user, client, theme, onToggleTheme }) {
  const who = (user && (user.name || user.email)) || "";
  const signOut = () => client.auth.signOut().then(() => location.reload());

  return (
    <div className="top">
      <div>
        <div className="eyebrow">Job Command Centre</div>
        <h1>Your pipeline</h1>
      </div>
      <div className="pill">
        <span style={{ color: "var(--gold)" }}>●</span> {who} ·{" "}
        <button onClick={signOut}>sign out</button> ·{" "}
        <button className="theme" title="Toggle theme" onClick={onToggleTheme}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </div>
  );
}
