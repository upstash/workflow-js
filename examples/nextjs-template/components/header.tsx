'use client'

export default function Header() {
  return (
    <header className="space-y-6">
      <img
        className="inline-flex w-10"
        src="/upstash-logo.svg"
        alt="upstash logo"
      />

      <h1 className="text-xl font-bold">Upstash Workflow x NextJS Template</h1>

      <h2>
        <span className="font-bold">
          This example has two methods of calling a long running mock API.
        </span>
      </h2>

      <ul>
        <li>- Method 1: Calling the API in a standard Vercel function</li>
        <li>- Method 2: Calling the API using Upstash Workflow</li>
      </ul>

      <p>
        Both methods start at the same time and take about the same time to
        finish. The key difference is the estimated cost per 1M requests (hover
        for details).
      </p>
    </header>
  )
}
