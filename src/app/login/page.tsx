export const metadata = { title: 'Enter demo — LeadFlow' }

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">LeadFlow</h1>
          <p className="mt-2 text-sm text-zinc-400">
            B2B lead-gen automation — import, dedupe, score, and work your pipeline in one place.
          </p>
        </div>
        <form method="post" action="/api/auth/demo">
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
          >
            Enter demo →
          </button>
        </form>
        <p className="mt-4 text-xs text-zinc-500">
          One click, no sign-up. Demo data is fake (Faker-generated) with duplicates planted on purpose.
        </p>
      </div>
    </main>
  )
}
