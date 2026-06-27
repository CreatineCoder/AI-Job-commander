export default function SignIn({ client }) {
  return (
    <div className="center">
      <div>
        <div className="eyebrow">Job Command Centre</div>
        <h1>Welcome.</h1>
        <p style={{ color: "var(--muted)" }}>Sign in to open your pipeline.</p>
        <button onClick={() => client.auth.redirectToAuth()}>Sign in</button>
      </div>
    </div>
  );
}
