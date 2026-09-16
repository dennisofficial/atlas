export default function HomePage() {
  return (
    <>
      <h1>Atlas</h1>
      <p className="muted">
        This service hosts Atlas Cloud sign-in. If a device sent you here,
        follow the link it opened instead of this one.
      </p>
      <p className="muted">
        <a href="/sign-in">Sign in</a> ·{" "}
        <a href="/sign-up">Create an account</a>
      </p>
    </>
  );
}
