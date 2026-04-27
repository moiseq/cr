type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const showError = params.error === "1";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-black/20">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Secure Access
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">CR Dashboard</h1>
          <p className="mt-3 text-sm text-slate-400">
            Autentica-te para aceder ao dashboard e ao proxy protegido da API.
          </p>
        </div>

        <form action="/auth/login" method="post" className="space-y-4">
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              required
              className="w-full rounded-lg border border-border bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-slate-500"
            />
          </label>

          <label className="block text-sm text-slate-300">
            <span className="mb-2 block">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-border bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-slate-500"
            />
          </label>

          {showError && (
            <p className="rounded-lg border border-red-900/80 bg-red-950/50 px-4 py-3 text-sm text-red-200">
              Credenciais inválidas.
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
          >
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}