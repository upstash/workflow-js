"use client"

import { useState } from "react";
import { triggerEmailAnalysis } from "./actions";

export default function Home() {
  const [formData, setFormData] = useState({
    to: "",
    subject: "",
    message: "",
    attachment: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; workflowRunId?: string; error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    const payload = {
      to: formData.to,
      subject: formData.subject,
      message: formData.message,
      attachment: formData.attachment || undefined,
    };

    const response = await triggerEmailAnalysis(payload);
    setResult(response);
    setLoading(false);
  };

  return (
    <div className="min-h-screen p-8 pb-20 sm:p-20 font-[family-name:var(--font-geist-sans)] text-black">
      <main className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Email Analyzer Test</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="to" className="block text-sm font-medium mb-2">
              To (Email Address)
            </label>
            <input
              type="email"
              id="to"
              value={formData.to}
              onChange={(e) => setFormData({ ...formData, to: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="subject" className="block text-sm font-medium mb-2">
              Subject
            </label>
            <input
              type="text"
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="message" className="block text-sm font-medium mb-2">
              Message
            </label>
            <textarea
              id="message"
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              rows={6}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="attachment" className="block text-sm font-medium mb-2">
              Attachment (PDF URL - Optional)
            </label>
            <input
              type="url"
              id="attachment"
              value={formData.attachment}
              onChange={(e) => setFormData({ ...formData, attachment: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://example.com/document.pdf"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Triggering Workflow..." : "Trigger Email Analysis"}
          </button>
        </form>

        {result && (
          <div className={`mt-6 p-4 rounded-lg ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {result.success ? (
              <div>
                <p className="font-medium">Workflow triggered successfully!</p>
                <p className="text-sm mt-1">Run ID: {result.workflowRunId}</p>
              </div>
            ) : (
              <div>
                <p className="font-medium">Error triggering workflow</p>
                <p className="text-sm mt-1">{result.error}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
