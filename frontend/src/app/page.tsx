export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-indigo-600">
          Pelican
        </h1>
        <p className="mt-4 text-xl text-gray-600 dark:text-gray-400">
          Shift management, simplified.
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <a
            href="/login"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-white font-medium hover:bg-indigo-700 transition"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="rounded-lg border border-indigo-600 px-6 py-3 text-indigo-600 font-medium hover:bg-indigo-50 transition"
          >
            Get Started
          </a>
        </div>
      </div>
    </main>
  );
}
