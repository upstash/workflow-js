"use client";

import Img from "next/image";
import * as React from "react";
import { FormEvent, useState, useEffect } from "react";
import {
  Step,
  StepContent,
  StepDesc,
  StepItem,
  StepNumber,
  StepTitle,
} from "./step-list";
import { AgentInfo } from "./agent-info";
import { WorkflowIcon } from "../icons/workflow-icon";
import { CODES } from "../constants/codes";
import type { AgentName, StepRecord, PollResult } from "../types";
import { AgentBlock } from "./agent-block";
import { IconBrandGithub, IconFile, IconLoader2 } from "@tabler/icons-react";
import { pollOutputs } from "../actions";
import DeployButton from "./deploy-button";

export const AgentUI = ({ session }: { session?: string }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(!!session);
  const [agentStates, setAgentStates] = useState<{
    Wikipedia: false | "loading" | StepRecord[];
    WolframAlpha: false | "loading" | StepRecord[];
    Exa: false | "loading" | StepRecord[];
    "Cross Reference": false | "loading" | StepRecord[];
  }>({
    Wikipedia: false,
    WolframAlpha: false,
    Exa: false,
    "Cross Reference": false,
  });

  const [agentInfoDisplay, setAgentInfoDisplay] = useState<AgentName | false>(
    false
  );
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (session) {
      setSessionLoading(true);

      // Set a timeout to ensure we don't show the loading state indefinitely
      const timeoutId = setTimeout(() => {
        setSessionLoading(false);
      }, 10000); // 10 seconds timeout

      pollSessionStatus(session);

      return () => clearTimeout(timeoutId);
    }
  }, [session]);

  const pollSessionStatus = async (workflowRunId: string) => {
    const scrolledIntermediate = false;

    try {
      setCurrentStep(1);
      setProgress(null);
      setAgentStates({
        Wikipedia: false,
        WolframAlpha: false,
        Exa: false,
        "Cross Reference": false,
      });
      setAgentInfoDisplay(false);

      try {
        const initialResult = await pollOutputs(workflowRunId);

        if (initialResult) {
          if (initialResult.query) {
            setQuery(initialResult.query);
          }

          updateUIFromResult(initialResult, scrolledIntermediate);

          // Set session loading to false as soon as we have the initial state
          setSessionLoading(false);

          if (initialResult.crossReferenceOutput) {
            setCurrentStep(5);
            return "All agents complete";
          }
        }
      } catch (error) {
        // Set session loading to false if there's an error
        setSessionLoading(false);
        console.error("Error getting initial status:", error);
      }

      const startTime = Date.now();
      const TIMEOUT_DURATION = 60000;
      const POLLING_INTERVAL = 2000;

      const pollStatus = async () => {
        try {
          const result = await pollOutputs(workflowRunId);

          if (!result) {
            return false;
          }

          updateUIFromResult(result, scrolledIntermediate);

          return result.crossReferenceOutput;
        } catch (error) {
          console.error("Polling error:", error);
          throw error;
        }
      };

      return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          if (Date.now() - startTime > TIMEOUT_DURATION) {
            clearInterval(interval);
            resolve("Timeout reached");
            return;
          }

          try {
            const isComplete = await pollStatus();
            if (isComplete) {
              setProgress(null);
              clearInterval(interval);
              resolve("All agents complete");
            }
          } catch (error) {
            clearInterval(interval);
            reject(error);
          }
        }, POLLING_INTERVAL);
      });
    } catch (error) {
      console.error("Error:", error);
    }
  };

  const updateUIFromResult = (
    result: PollResult,
    scrolledIntermediate: boolean
  ) => {
    setLoading(true);

    setCurrentStep(2);

    setProgress(result.progress || null);

    setAgentStates((prevStates) => ({
      ...prevStates,
      Wikipedia: result.wikipediaOutput || prevStates.Wikipedia,
      WolframAlpha: result.wolframAlphaOutput || prevStates.WolframAlpha,
      Exa: result.searchOutput || prevStates.Exa,
      "Cross Reference":
        result.crossReferenceOutput || prevStates["Cross Reference"],
    }));

    const intermediateResult =
      result.wikipediaOutput ||
      result.wolframAlphaOutput ||
      result.searchOutput;

    if (intermediateResult) {
      setCurrentStep(3);
    }

    if (intermediateResult && !scrolledIntermediate) {
      if (result.wikipediaOutput) {
        setAgentInfoDisplay("Wikipedia");
      } else if (result.wolframAlphaOutput) {
        setAgentInfoDisplay("WolframAlpha");
      } else if (result.searchOutput) {
        setAgentInfoDisplay("Exa");
      }
      document
        .getElementById("intermediate-output")
        ?.scrollIntoView({ behavior: "smooth" });
      scrolledIntermediate = true;
    }

    if (result.crossReferenceOutput) {
      setCurrentStep(5);
      setLoading(false);
      document
        .getElementById("cross-reference-output")
        ?.scrollIntoView({ behavior: "smooth" });
    }

    return;
  };

  const handleSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      setCurrentStep(1);
      setLoading(true);
      setProgress(null);
      setAgentStates({
        Wikipedia: false,
        WolframAlpha: false,
        Exa: false,
        "Cross Reference": false,
      });

      const response = await fetch("/api/research", {
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        body: query,
      });

      const workflowRunId = (await response.json()).workflowRunId;

      window.history.replaceState({}, "", `/${workflowRunId}`);

      return pollSessionStatus(workflowRunId);
    } catch (error) {
      console.error("Error:", error);
      setLoading(false);
    }
  };

  const resolveStepStatus = (stepNumber: number) => {
    return currentStep === stepNumber
      ? "loading"
      : currentStep > stepNumber
      ? "done"
      : "init";
  };

  const displayUsedResources = [...Object.entries(agentStates)]
    .filter(([key, value]) => value && key !== "Cross Reference")
    .map(([key]) => key);

  // Skeleton UI component for loading state
  const SkeletonUI = () => (
    <div className="animate-pulse">
      <div className="px-8 mx-auto max-w-screen-sm">
        <div className="mt-16 md:mt-16">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="mb-1">
              {step === 1 && (
                <div className="flex items-start gap-4">
                  <div className="flex flex-col gap-2 items-center">
                    <div className="h-8 w-8 rounded-full bg-gray-200"></div>
                    <div className="h-32 bg-gray-200 rounded w-1"></div>
                  </div>
                  <div className="w-full mt-1">
                    <div className="h-5 bg-gray-200 rounded w-48 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-full mb-4"></div>
                    <div className="flex flex-row gap-2 items-center w-full">
                      <div className="h-9 bg-gray-200 rounded w-full"></div>
                      <div className="h-9 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="flex items-start gap-4">
                  <div className="flex flex-col gap-2 items-center">
                    <div className="h-8 w-8 rounded-full bg-gray-200"></div>
                    <div className="h-80 bg-gray-200 rounded w-1"></div>
                  </div>
                  <div className="mt-1 w-full">
                    <div className="h-5 bg-gray-200 rounded w-64 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-44 mb-4"></div>
                    <div className="h-4 bg-gray-200 rounded w-96 mb-4"></div>
                    <div className="flex flex-row gap-2 items-center w-full mb-4">
                      <div className="h-16 w-16 bg-gray-200 rounded-xl"></div>
                      <div className="h-16 w-16 bg-gray-200 rounded-xl"></div>
                      <div className="h-16 w-16 bg-gray-200 rounded-xl"></div>
                    </div>
                    <div className="h-10 bg-gray-200 rounded-xl w-full mb-4"></div>
                    <div className="h-10 bg-gray-200 rounded-xl w-full mb-4"></div>
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="flex items-start gap-4">
                  <div className="flex flex-col gap-2 items-center">
                    <div className="h-8 w-8 rounded-full bg-gray-200"></div>
                    <div className="h-96 bg-gray-200 rounded w-1"></div>
                  </div>
                  <div className="mt-1 w-full">
                    <div className="h-5 bg-gray-200 rounded w-48 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-full mb-4"></div>
                    <div className="h-10 bg-gray-200 rounded-xl w-full mb-4"></div>
                    <div className="h-10 bg-gray-200 rounded-xl w-full mb-4"></div>
                    <div className="h-48 bg-gray-200 rounded-xl w-full mb-4"></div>
                  </div>
                </div>
              )}
              {step === 4 && (
                <div className="flex items-start gap-4">
                  <div className="flex flex-col gap-2 items-center">
                    <div className="h-8 w-8 rounded-full bg-gray-200"></div>
                    <div className="h-80 bg-gray-200 rounded w-1"></div>
                  </div>
                  <div className="mt-1 w-full">
                    <div className="h-5 bg-gray-200 rounded w-48 mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded-md w-20 mb-4"></div>
                    <div className="h-8 bg-gray-200 rounded-xl w-48 mb-4"></div>
                    <div className="h-48 bg-gray-200 rounded-xl w-full mb-4"></div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (sessionLoading) {
    return (
      <main>
        <div className="pb-24">
          <Header />
          <SkeletonUI />
        </div>
      </main>
    );
  }

  return (
    <main>
      {progress && (
        <div className="fixed bottom-5 right-5 bg-purple-500/10 text-purple-500 border-purple-500 border-2 px-4 py-2 rounded-md font-semibold flex flex-row gap-2">
          <div>{progress}</div>
          <IconLoader2 className="animate-spin" size={28} />
        </div>
      )}

      <div className="pb-24">
        {/* header */}
        <Header />

        {/* step-by-step */}
        <section className="px-8 mx-auto max-w-screen-sm">
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
                    disabled={loading}
                    className="block w-full h-9 px-4 bg-white border border-gray-300 rounded-md"
                  />

                  <button
                    disabled={loading}
                    className={`h-9 rounded-md bg-purple-500 px-4 text-white ${
                      loading ? "opacity-30" : ""
                    }`}
                  >
                    {loading ? "Searching..." : "Search"}
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
                    {displayUsedResources.length > 0 && (
                      <span className="opacity-60">
                        Your agent chose to use{" "}
                        {displayUsedResources.join(", ")} to answer your
                        question.
                      </span>
                    )}
                    <div className="flex gap-2 w-full">
                      <AgentBlock
                        name="Wikipedia"
                        agentInfoDisplay={agentInfoDisplay}
                        setAgentInfoDisplay={setAgentInfoDisplay}
                        isDisabled={agentStates["Wikipedia"] === false}
                      >
                        <Img
                          src="/icons/wikipedia.png"
                          width={34}
                          height={34}
                          alt="Wikipedia"
                          className={
                            agentStates["Wikipedia"] === false
                              ? "opacity-60"
                              : "opacity-100"
                          }
                        />
                      </AgentBlock>
                      <AgentBlock
                        name="WolframAlpha"
                        agentInfoDisplay={agentInfoDisplay}
                        setAgentInfoDisplay={setAgentInfoDisplay}
                        isDisabled={agentStates["WolframAlpha"] === false}
                      >
                        <Img
                          src="/icons/wolfram-alpha.png"
                          width={40}
                          height={40}
                          alt="WolframAlpha"
                          className={
                            agentStates["WolframAlpha"] === false
                              ? "opacity-60"
                              : "opacity-100"
                          }
                        />
                      </AgentBlock>
                      <AgentBlock
                        name="Exa"
                        agentInfoDisplay={agentInfoDisplay}
                        setAgentInfoDisplay={setAgentInfoDisplay}
                        isDisabled={agentStates["Exa"] === false}
                      >
                        <Img
                          src="/icons/exa.jpg"
                          width={30}
                          height={30}
                          alt="Exa"
                          className={
                            agentStates["Exa"] === false
                              ? "opacity-60 rounded-md"
                              : "opacity-100 rounded-md"
                          }
                        />
                      </AgentBlock>
                    </div>
                    {agentInfoDisplay && (
                      <AgentInfo
                        name={agentInfoDisplay}
                        code={CODES[agentInfoDisplay]}
                        state={agentStates[agentInfoDisplay]}
                      />
                    )}
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
                    code={CODES["Cross Reference"]}
                    state={agentStates["Cross Reference"]}
                  />
                </StepContent>
              )}
            </StepItem>

            {/* step-4 */}
            <StepItem status={resolveStepStatus(4)}>
              <StepNumber order={4} status={resolveStepStatus(4)} />

              <StepTitle>See Logs in Upstash Console</StepTitle>
              <StepDesc>
                After running the workflow, navigate to the Upstash Console to
                see the related logs.
              </StepDesc>

              {currentStep > 3 && (
                <StepContent>
                  <a
                    className="inline-flex items-center gap-1 h-8 px-4 rounded-md bg-purple-500 text-white hover:bg-purple-400"
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
                    className="block mt-8"
                    src="/screenshot.png"
                    width={1564}
                    height={476}
                    alt="s"
                  />
                </StepContent>
              )}
            </StepItem>
          </Step>
        </section>
      </div>
    </main>
  );
};

const Header = () => {
  return (
    <header className="bg-purple-50  text-center">
      <div className="mx-auto max-w-screen-sm px-8 py-12">
        <h1 className="text-3xl font-bold">Cross Reference Agent</h1>

        <div className="mt-2 text-lg opacity-60">
          This is a simple example to demonstrate how to use
          <WorkflowIcon size={18} className="ml-2 inline-flex" /> Upstash
          Workflow Agents to cross-reference information from different sources.
        </div>

        <div className="flex justify-center items-center gap-6 mt-4">
          <a
            className="inline-flex items-center font-medium gap-0.5 underline"
            href="https://upstash.com/docs/qstash/workflow/quickstarts/vercel-nextjs"
            target="_blank"
          >
            <IconFile size={18} />
            Docs
          </a>
          <a
            className="inline-flex items-center gap-0.5 font-medium underline"
            href="https://github.com/upstash/workflow-js/tree/main/examples/agents-researcher"
            target="_blank"
          >
            <IconBrandGithub size={18} />
            Repository
          </a>
          <div className="h-8 w-[103px]">
            <DeployButton />
          </div>
        </div>
      </div>
    </header>
  );
};
