'use client';

import Img from 'next/image';
import { FormEvent, Suspense, useState } from 'react';
import {
  Step,
  StepItem,
  StepNumber,
  StepTitle,
  StepContent,
  StepDesc
} from './components/step-list';
import { AgentInfo } from './components/agent-info';
import { WorkflowIcon } from './icons/workflow-icon';
import { CODES } from './constants/codes';
import type { AgentName, StepRecord } from './types';
import { AgentBlock } from './components/agent-block';
import { IconLoader } from './icons/loader';

export default function HomePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Page />
    </Suspense>
  );
}
const Page = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [agentStates, setAgentStates] = useState<{
    Wikipedia: false | 'loading' | StepRecord[];
    WolframAlpha: false | 'loading' | StepRecord[];
    DuckDuckGo: false | 'loading' | StepRecord[];
    'Cross Reference': false | 'loading' | StepRecord[];
  }>({
    Wikipedia: false,
    WolframAlpha: false,
    DuckDuckGo: false,
    'Cross Reference': false
  });

  const [agentInfoDisplay, setAgentInfoDisplay] =
    useState<AgentName | false>(false);
  const [currentStep, setCurrentStep] = useState(0);

  // form submit handler
  const handleSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let scrolledIntermediate = false;
    let intermediateLogged = false;

    try {
      setCurrentStep(1);
      setLoading(true);
      setProgress(null);
      setAgentStates({
        Wikipedia: false,
        WolframAlpha: false,
        DuckDuckGo: false,
        'Cross Reference': false
      });
      const response = await fetch('/api/research', {
        headers: {
          'Content-Type': 'application/json'
        },
        method: 'POST',
        body: query
      });
      const workflowRunId = (await response.json()).workflowRunId;

      const startTime = Date.now();
      const TIMEOUT_DURATION = 60000;
      const POLLING_INTERVAL = 2000;

      const pollStatus = async () => {
        try {
          const statusResponse = await fetch('/api/poll-outputs', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              workflowRunId
            })
          });

          if (!statusResponse.ok) {
            throw new Error('Status check failed');
          }

          const result = await statusResponse.json();

          if (result.progress) {
            setLoading(false);
            if (result.progress === 'Call Agent Manager LLM') {
              setCurrentStep(intermediateLogged ? 3 : 2);
            } else {
              intermediateLogged = true;
            }
          }

          setProgress(result.progress);
          setAgentStates((prevStates) => ({
            ...prevStates,
            Wikipedia: result.wikipediaOutput || prevStates.Wikipedia,
            WolframAlpha: result.wolframAlphaOutput || prevStates.WolframAlpha,
            DuckDuckGo: result.searchOutput || prevStates.DuckDuckGo,
            'Cross Reference':
              result.crossReferenceOutput || prevStates['Cross Reference']
          }));

          if (
            (result.wikipediaOutput ||
              result.wolframAlphaOutput ||
              result.searchOutput) &&
            !scrolledIntermediate
          ) {
            if (result.wikipediaOutput) {
              setAgentInfoDisplay('Wikipedia');
            } else if (result.wolframAlphaOutput) {
              setAgentInfoDisplay('WolframAlpha');
            } else if (result.searchOutput) {
              setAgentInfoDisplay('DuckDuckGo');
            }
            document
              .getElementById('intermediate-output')
              ?.scrollIntoView({ behavior: 'smooth' });
            scrolledIntermediate = true;
          }

          if (result.crossReferenceOutput) {
            setCurrentStep(5);
            document
              .getElementById('cross-reference-output')
              ?.scrollIntoView({ behavior: 'smooth' });
          }

          return result.crossReferenceOutput;
        } catch (error) {
          console.error('Polling error:', error);
          throw error;
        }
      };

      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          if (Date.now() - startTime > TIMEOUT_DURATION) {
            clearInterval(interval);
            resolve('Timeout reached');
            return;
          }

          try {
            const isComplete = await pollStatus();
            if (isComplete) {
              setProgress(null);
              clearInterval(interval);
              resolve('All agents complete');
            }
          } catch (error) {
            clearInterval(interval);
            reject(error);
          }
        }, POLLING_INTERVAL);
      });
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const resolveStepStatus = (stepNumber: number) => {
    return (currentStep === stepNumber ? "loading" : currentStep > stepNumber ? "done" : "init");
  }

  const displayUsedResources = [...Object.entries(agentStates)]
  .filter(([key, value]) => value && key !== "Cross Reference")
  .map(([key]) => key)

  return (
    <main className="h-screen">
      {progress && (
        <div className="fixed bottom-5 right-5 bg-purple-500/10 text-purple-500 border-purple-500 border-2 px-4 py-2 rounded-md font-semibold flex flex-row gap-2">
          <div>{progress}</div>
          <IconLoader className="animate-spin" />
        </div>
      )}
      <div className="max-w-screen-sm px-8 pt-16 mx-auto pb-44">
        {/* header */}
        <header>
          <h1 className="text-2xl font-semibold text-balance mb-8">
            Cross Reference Agent
          </h1>
          <div className="text-lg text-balance flex flex-row flex-wrap items-center gap-2">
            <span className="text-zinc-500">
              This is a simple example to demonstrate how to use
              <div className="inline-block mx-1 align-text-bottom">
                <WorkflowIcon size={22} />
              </div>
              Upstash Workflow Agents to cross-reference information from different sources.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <a
              className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 rounded-md hover:bg-purple-100"
              href="https://upstash.com/docs/qstash/workflow/quickstarts/vercel-nextjs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M10 13l-1 2l1 2" />
                <path d="M14 13l1 2l-1 2" />
              </svg>
              Docs
            </a>
            <a
              className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 rounded-md hover:bg-purple-100"
              href="https://github.com/upstash/workflow-js/tree/main/examples/nextjs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
              </svg>
              Repository
            </a>
          </div>
        </header>

        {/* step-by-step */}
        <Step className="mt-16 md:mt-16">
          {/* step-1 */}
          <StepItem status={resolveStepStatus(1)}>
            <StepNumber order={1} status={resolveStepStatus(1)} />

            <StepTitle>Ask a Question</StepTitle>
            <StepDesc>
              Try different questions to see how different resources come into
              play.
            </StepDesc>

            <StepContent>
              <form
                onSubmit={handleSend}
                className="flex flex-row gap-2 items-center"
              >
                {/* search input */}
                <input
                  placeholder="What is the capital of France?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="block w-full h-8 px-2 bg-white border border-gray-300 rounded-md"
                />

                <button
                  disabled={loading}
                  className={`h-8 rounded-md bg-purple-500 px-4 text-white ${
                    loading ? 'opacity-30' : ''
                  }`}
                >
                  {loading ? 'Starting...' : 'Start'}
                </button>
              </form>
            </StepContent>
          </StepItem>

          {/* step-2 */}
          <StepItem status={resolveStepStatus(2)}>
            <StepNumber order={2} status={resolveStepStatus(2)} />

            <StepTitle>View Answers From Various Resources</StepTitle>
            <StepDesc>
              The cross-reference agent will orchestrate worker agents to get
              answers from different resources.
            </StepDesc>

            {currentStep > 1 && (
            <StepContent>
              <div className="flex flex-col gap-4">
                {displayUsedResources.length > 0 &&
                <span className='opacity-60'>
                  Your agent chose to use {
                    displayUsedResources
                    .join(', ')} to answer your question.
                </span>
}
                <div className="flex gap-4 w-full">
                  <AgentBlock
                    name="Wikipedia"
                    agentInfoDisplay={agentInfoDisplay}
                    setAgentInfoDisplay={setAgentInfoDisplay}
                    isDisabled={agentStates['Wikipedia'] === false}
                  >
                    <Img
                      src="/icons/wikipedia.png"
                      width={44}
                      height={44}
                      alt="Wikipedia"
                      className={agentStates['Wikipedia'] === false ? 'opacity-60' : 'opacity-100'}
                    />
                  </AgentBlock>
                  <AgentBlock
                    name="WolframAlpha"
                    agentInfoDisplay={agentInfoDisplay}
                    setAgentInfoDisplay={setAgentInfoDisplay}
                    isDisabled={agentStates['WolframAlpha'] === false}
                  >
                    <Img
                      src="/icons/wolfram-alpha.png"
                      width={48}
                      height={48}
                      alt="WolframAlpha"
                      className={agentStates['WolframAlpha'] === false ? 'opacity-60' : 'opacity-100'}
                    />
                  </AgentBlock>
                  <AgentBlock
                    name="DuckDuckGo"
                    agentInfoDisplay={agentInfoDisplay}
                    setAgentInfoDisplay={setAgentInfoDisplay}
                    isDisabled={agentStates['DuckDuckGo'] === false}
                  >
                    <Img
                      src="/icons/duckduckgo.png"
                      width={40}
                      height={40}
                      alt="DuckDuckGo"
                      className={agentStates['DuckDuckGo'] === false ? 'opacity-60' : 'opacity-100'}
                    />
                  </AgentBlock>
                </div>
                {agentInfoDisplay &&
                <AgentInfo
                  name={agentInfoDisplay}
                  code={CODES[agentInfoDisplay]}
                  state={agentStates[agentInfoDisplay]}
                />
}
              </div>
            </StepContent>
)}
          </StepItem>

          {/* step-3 */}
          <StepItem status={resolveStepStatus(3)}>
            <StepNumber order={3} status={resolveStepStatus(3)} />

            <StepTitle>See Final Summary with References</StepTitle>
            <StepDesc>
              The cross-reference agent will summarize the answers with
              references.
            </StepDesc>

            {currentStep > 2 && (
            <StepContent>
              <AgentInfo
                name="Cross Reference"
                code={CODES['Cross Reference']}
                state={agentStates['Cross Reference']}
              />
            </StepContent>
)}
          </StepItem>

          {/* step-4 */}
          <StepItem status={resolveStepStatus(4)}>
            <StepNumber order={4} status={resolveStepStatus(4)} />

            <StepTitle>See Logs in Upstash Console</StepTitle>
            <StepDesc>
              After running the workflow, navigate to the Upstash Console to see
              the related logs.
            </StepDesc>

            {currentStep > 3 && (
            <StepContent>
              <a
                className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-purple-500 text-white hover:bg-purple-400"
                href="https://console.upstash.com/qstash?tab=workflow"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
                  <path d="M11 13l9 -9" />
                  <path d="M15 4h5v5" />
                </svg>
                Upstash Console
              </a>

              <Img
                className="block mt-4"
                src="/ss.png"
                width={1564}
                height={476}
                alt="s"
              />
            </StepContent>
)}
          </StepItem>
        </Step>
      </div>
    </main>
  );
};
