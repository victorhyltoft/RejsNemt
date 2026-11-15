export default async function Login({ searchParams }: { searchParams: Promise<{ fejl?: string }> }) {
  const { fejl } = await searchParams;
  return (
    <main className="login">
      <h1>Afsted</h1>
      <p>Indtast din kode for at fortsætte.</p>
      <form method="post" action="/api/login">
        <input name="code" type="password" inputMode="numeric" autoFocus placeholder="Kode" aria-label="Kode" />
        <button className="go" type="submit">Lås op</button>
      </form>
      {fejl && <p className="err">Forkert kode</p>}
    </main>
  );
}
