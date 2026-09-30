export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">
        Crystal Ball
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">
        Foundation ready
      </h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-white/70">
        Scaffolding only. Modes, streaming, and AI features are not implemented
        yet.
      </p>
    </main>
  );
}
