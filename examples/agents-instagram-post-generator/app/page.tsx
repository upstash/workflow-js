'use client'

import { FormEvent, useState, useEffect } from 'react';
import { 
  Step, 
  StepItem, 
  StepNumber, 
  StepTitle, 
  StepContent, 
  StepDesc 
} from '@/components/step-list';

import { Loader2 } from "lucide-react";

export type Post = {
  imageUrl: string;
    prompt: string;
    caption: string;
}
export type Result = {
  posts: Post[];
};

const INITIAL_DELAY = 120*1000; // 120 seconds
const POLLING_INTERVAL = 5*1000; // 5 seconds


const generateCallKey = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const InstagramGeneratorPage = () => {
  const [loading, setLoading] = useState(false);
  const [productUrl, setProductUrl] = useState('');
  const [description, setDescription] = useState('');
  const [results, setResults] = useState<Result>();
  const [error, setError] = useState<string | null>(null);
  const [callKey, setCallKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (!callKey || !loading) return;

    const pollResults = async () => {
      try {
        const response = await fetch('/api/check-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callKey }),
        });

        if (!response.ok) throw new Error('Failed to check results');

        const data = await response.json();
        if (data) {
          setResults(data);
          setLoading(false);
          setCallKey(null);
          setStatus('');
          return true;
        }
        return false;
      } catch (err) {
        console.error('Polling error:', err);
        return false;
      }
    };


    
    setStatus('Initializing generation...');
    const initialTimer = setTimeout(() => {
      setStatus('Checking results...');
      const interval = setInterval(async () => {
       
        const succeeded = await pollResults();
        if (succeeded){
          clearInterval(interval);
        }

      }, POLLING_INTERVAL);

      // Cleanup interval
      return () => clearInterval(interval);
    }, INITIAL_DELAY);

    // Cleanup initial timer
    return () => clearTimeout(initialTimer);
  }, [callKey, loading]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(undefined);
    setStatus('Starting generation...');

    const newCallKey = generateCallKey();
    setCallKey(newCallKey);

    try {
      const response = await fetch('/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'callKey': newCallKey
        },
        body: JSON.stringify({
          productWebsite: productUrl,
          productDetails: description,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start generation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation');
      setLoading(false);
      setCallKey(null);
      setStatus('');
    }
  };

  

  return (
    <main className="min-h-screen bg-gray-50 !text-zinc-800">
      <div className="max-w-screen-sm px-8 pt-16 mx-auto pb-44">
        {/* Header */}
        <header>
          <div className="w-10 h-10 mb-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500" />
          
          <h1 className="text-2xl font-semibold text-balance">
            Instagram Post Generator
          </h1>
          <h2 className="text-lg text-balance opacity-60">
            Generate engaging Instagram posts with AI-powered captions and image descriptions.
            Simply enter your product details below.
          </h2>
        </header>

        {/* Main Content */}
        <Step className="mt-16">
          {/* Input Form */}
          <StepItem>
            <StepNumber order={1} />
            <StepTitle>Enter Product Details</StepTitle>
            <StepDesc>
              Provide your product website URL and any additional details about your product
              or the type of Instagram post you want to create.
            </StepDesc>
            
            <StepContent>
              <form onSubmit={handleSubmit} className="grid gap-4 p-6 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10">
                <div>
                  <label className="text-xs uppercase opacity-60">Product Website URL</label>
                  <input
                    type="url"
                    value={productUrl}
                    onChange={(e) => setProductUrl(e.target.value)}
                    placeholder="https://your-product.com"
                    className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs uppercase opacity-60">Product Description & Requirements</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe your product and any specific requirements for the Instagram post..."
                    rows={4}
                    className="block w-full px-3 py-2 mt-1 bg-white border border-gray-300 rounded-md"
                    required
                  />
                </div>

                <button
            disabled={loading}
            className={`h-10 rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-4 text-white font-medium 
              flex items-center justify-center gap-2
              ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? (status || 'Processing...') : 'Generate Post'}
          </button>

          {error && (
            <div className="p-3 text-sm text-red-600 rounded-md bg-red-50">
              {error}
            </div>
          )}
              </form>
            </StepContent>
          </StepItem>

          {/* Results Section */}
          {results && (
          <StepItem>
            <StepNumber order={2} />
            <StepTitle>Generated Content</StepTitle>
            <StepDesc>
              Here are your AI-generated Instagram posts with images and captions.
            </StepDesc>

            <StepContent>
              <div className="grid gap-6">
                {results.posts.map((post, idx) => (
                  <div key={idx} className="overflow-hidden bg-white border border-gray-200 rounded-xl">
                    <div className="grid gap-4 p-4 md:grid-cols-2">
                      <div className="overflow-hidden rounded-lg aspect-square">
                        <img
                          src={post.imageUrl} 
                          alt={`Generated post ${idx + 1}`}
                          className="object-cover w-full h-full"
                          width={500}
                          height={500}
                        />
                      </div>

                      <div className="space-y-4">
                        <div>
                          <h3 className="mb-2 text-lg font-medium">Caption</h3>
                          <p className="text-gray-600">
                            {post.caption}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </StepContent>
          </StepItem>
        )}
        </Step>
      </div>
    </main>
  );
};

export default InstagramGeneratorPage;