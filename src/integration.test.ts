/**
 * # End-to-end workflow tests
 *
 * In these tests, we define workflow endpoints using QStash serve method and
 * creating an HTTP server with them (see `testEndpoint` method). After creating
 * the workflow endpoint, `testEndpoint` makes the initial request to the endpoint.
 *
 * Endpoint calls QStash and a workflow execution commences. We wait for some time
 * before killing the server. After killing the server, we check:
 * - the number of times the endpoint was called
 * - whether the route reached it's end (see `FinishState`)
 *
 * # How to run
 *
 * Since these tests require a local tunnel or a local QStash server, we can't run
 * them in CI. So they are skipped. But they are still useful for local development.
 *
 * ## With Local QStash Server
 *
 * To run the tests, you can locally run the QStash server at localhost:8000. Don't
 * forget to set the QSTASH_TOKEN, QSTASH_URL, QSTASH_CURRENT_SIGNING_KEY and
 * QSTASH_NEXT_SIGNING_KEY environemnt variables after starting the server.
 *
 * ## With Ngrok
 *
 * Alternative to running QStash locally is to expose the localhost endpoints
 * with local tunneling using Ngrok. To make this easier, we have added a bash
 * script `integration.sh`. To run the script, first get your ngrok token from
 * https://dashboard.ngrok.com/get-started/your-authtoken and update the
 * `integration.yml` file with your token. Afterwards, run the bash script with:
 *
 * ```sh
 * bash integration.sh <QSTASH_URL> <QSTASH_TOKEN> <QSTASH_CURRENT_SIGNING_KEY> <QSTASH_NEXT_SIGNING_KEY>
 * ```
 *
 * You can find the values of these variables from Upstash console.
 *
 * The script will:
 * - start a Ngrok local tunnel, exposing ports 3000 and 3001
 * - update the integration test by disabling skip and updating the
 *   URLs with the ones from Ngrok tunnel
 * - run the tests
 *
 * You may want to increase the `waitFor` and `timeout` parameters of the tests
 * because network takes some time.
 */

/* eslint-disable @typescript-eslint/no-magic-numbers */

import { serve } from "bun";
import { serve as workflowServe } from "../platforms/nextjs";
import { expect, test, describe } from "bun:test";
import { Client as QStashClient } from "@upstash/qstash";
import type { RouteFunction, WaitStepResponse, WorkflowServeOptions } from "./types";
import type { NextRequest } from "next/server";
import { Client } from "./client";
import { nanoid } from "./utils";
import { makeGetWaitersRequest } from "./client/utils";

const WORKFLOW_PORT = "3000";
const THIRD_PARTY_PORT = "3001";
const LOCAL_THIRD_PARTY_URL = `http://localhost:${THIRD_PARTY_PORT}`;

const someWork = (input: string) => {
  return `processed '${input}'`;
};

type Invoice = {
  date: number;
  email: string;
  amount: number;
};

type Charge = {
  invoice: Invoice;
  success: boolean;
};

export class FinishState {
  public finished = false;
  public finish() {
    this.finished = true;
  }
  public check() {
    expect(this.finished).toBeTrue();
  }
}

let counter = 0;
const attemptCharge = () => {
  counter += 1;
  if (counter === 3) {
    counter = 0;
    return true;
  }
  return false;
};

const qstashClient = new QStashClient({
  baseUrl: process.env.MOCK_QSTASH_URL,
  token: process.env.MOCK_QSTASH_TOKEN ?? "",
});

const testEndpoint = async <TInitialPayload = unknown>({
  finalCount,
  waitFor,
  initialPayload,
  routeFunction,
  finishState,
  failureFunction,
  retries,
  port = WORKFLOW_PORT,
}: {
  finalCount?: number;
  waitFor: number;
  initialPayload: TInitialPayload;
  routeFunction: RouteFunction<TInitialPayload>;
  finishState: FinishState;
  failureFunction?: WorkflowServeOptions["failureFunction"];
  retries?: number;
  port?: string;
}) => {
  let counter = 0;

  const { POST: endpoint } = workflowServe<TInitialPayload>(routeFunction, {
    qstashClient,
    url: `http://localhost:${port}`,
    verbose: true,
    failureFunction,
    retries,
  });

  const server = serve({
    async fetch(request) {
      counter += 1;
      return await endpoint(request as NextRequest);
    },
    port: port,
  });

  await qstashClient.publishJSON({
    method: "POST",
    body: initialPayload,
    headers: {
      Authentication: "Bearer secretPassword",
    },
    url: `http://localhost:${port}`,
  });

  await new Promise((resolve) => setTimeout(resolve, waitFor));

  server.stop();

  finishState.check();
  if (finalCount) {
    expect(counter).toBe(finalCount);
  }
};

describe.skip("live serve tests", () => {
  test(
    "path endpoint",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 4,
        waitFor: 7000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;

          expect(input).toBe("my-payload");

          const result1 = await context.run("step1", async () => {
            return await Promise.resolve(someWork(input));
          });

          expect(result1).toBe("processed 'my-payload'");

          const result2 = await context.run("step2", async () => {
            const result = someWork(result1);
            return await Promise.resolve(result);
          });

          expect(result2).toBe("processed 'processed 'my-payload''");
          finishState.finish();
        },
      });
    },
    {
      timeout: 10_000,
    }
  );

  test(
    "path sleep",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 7,
        waitFor: 20_000,
        initialPayload: undefined,
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;
          expect(input).toBeUndefined();

          const result1 = await context.run("step1", () => {
            const output = 123;
            return output;
          });
          expect(result1).toBe(123);

          await context.sleepUntil("sleep1", Date.now() / 1000 + 3);

          const result2 = await context.run("step2", () => {
            const output = 234;
            return output;
          });
          expect(result2).toBe(234);

          await context.sleep("sleep2", 2);

          const result3 = await context.run("step3", () => {
            const output = 345;
            return output;
          });
          expect(result3).toBe(345);
          finishState.finish();
        },
      });
    },
    {
      timeout: 25_000,
    }
  );

  test(
    "sleepWithoutAwait endpoint",
    async () => {
      const payload = { date: 123, email: "my@mail.com", amount: 10 };
      const finishState = new FinishState();
      await testEndpoint<Invoice>({
        finalCount: 13,
        waitFor: 25_000,
        initialPayload: payload,
        finishState,
        routeFunction: async (context) => {
          const invoice = context.requestPayload;
          expect(invoice).toEqual(payload);

          for (let index = 0; index < 3; index++) {
            const charge = await context.run("attemptCharge", () => {
              const success = attemptCharge();
              const charge: Charge = { invoice, success };
              return charge;
            });

            if (charge.success) {
              const [updateDb, receipt, sleepResult] = await Promise.all([
                context.run("updateDb", () => {
                  return charge.invoice.amount;
                }),
                context.run("sendReceipt", () => {
                  return charge.invoice.email;
                }),
                context.sleep("sleep", 5),
              ]);
              expect(updateDb).toBe(10);
              expect(receipt).toBe("my@mail.com");
              expect(sleepResult).toBeUndefined();
              finishState.finish();
              return;
            }
            await context.sleep("retrySleep", 2);
          }
          await context.run("paymentFailed", () => {
            return true;
          });
        },
      });
    },
    {
      timeout: 30_000,
    }
  );

  test(
    "auth endpoint",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 4,
        waitFor: 10_000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          if (context.headers.get("authentication") !== "Bearer secretPassword") {
            console.error("Authentication failed.");
            return;
          }

          const input = context.requestPayload;

          expect(input).toBe("my-payload");

          const result1 = await context.run("step1", () => {
            return someWork(input);
          });

          expect(result1).toBe("processed 'my-payload'");

          const result2 = await context.run("step2", () => {
            const result = someWork(result1);
            return result;
          });

          expect(result2).toBe("processed 'processed 'my-payload''");
          finishState.finish();
        },
      });
    },
    {
      timeout: 12_000,
    }
  );

  test(
    "auth endpoint - failed authentication",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 1,
        waitFor: 4500,
        initialPayload: "my-payload",
        finishState,
        // eslint-disable-next-line @typescript-eslint/require-await
        routeFunction: async (context) => {
          if (context.headers.get("authentication") !== "Bearer aDifferentPassword") {
            console.error("Authentication failed.");
            finishState.finish();
            return;
          }
          throw new Error("shouldn't be here.");
        },
      });
    },
    {
      timeout: 5000,
    }
  );

  test(
    "call endpoint",
    async () => {
      const thirdPartyResult = "third-party-result";
      const postHeader = {
        "post-header": "post-header-value-x",
      };
      const getHeader = {
        "get-header": "get-header-value-x",
      };
      const thirdPartyServer = serve({
        async fetch(request) {
          if (request.method === "GET") {
            return new Response(
              `called GET '${thirdPartyResult}' '${request.headers.get("get-header")}'`,
              {
                status: 200,
              }
            );
          } else if (request.method === "POST") {
            return new Response(
              `called POST '${thirdPartyResult}' '${request.headers.get("post-header")}' '${await request.text()}'`,
              {
                status: 200,
              }
            );
          } else {
            return new Response("method not allowed", { status: 400 });
          }
        },
        port: THIRD_PARTY_PORT,
      });

      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 7,
        waitFor: 12_000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          if (context.headers.get("authentication") !== "Bearer secretPassword") {
            console.error("Authentication failed.");
            return;
          }

          const { body: postResult } = await context.call<string>("post call", {
            url: LOCAL_THIRD_PARTY_URL,
            method: "POST",
            body: "post-payload",
            headers: postHeader,
          });
          expect(postResult).toBe(
            "called POST 'third-party-result' 'post-header-value-x' '\"post-payload\"'"
          );

          await context.sleep("sleep 1", 2);

          const { body: getResult } = await context.call<string>("get call", {
            url: LOCAL_THIRD_PARTY_URL,
            headers: getHeader,
          });

          expect(getResult).toBe("called GET 'third-party-result' 'get-header-value-x'");
          finishState.finish();
        },
      });

      thirdPartyServer.stop();
    },
    {
      timeout: 15_000,
    }
  );

  test(
    "async/sync run methods",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 5,
        waitFor: 7000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          const result1 = await context.run("async step", async () => {
            return await Promise.resolve("result1");
          });

          expect(result1).toBe("result1");

          const result2 = await context.run("sync step", () => {
            return "result2";
          });

          expect(result2).toBe("result2");

          const result3 = await context.run("sync step returning promise", () => {
            return Promise.resolve("result3");
          });

          expect(result3).toBe("result3");
          finishState.finish();
        },
      });
    },
    {
      timeout: 10_000,
    }
  );

  test(
    "failureFunction",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 3,
        waitFor: 7000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;

          expect(input).toBe("my-payload");

          await context.run("step1", () => {
            throw new Error("my-custom-error");
          });
        },
        retries: 0,
        failureFunction: ({ context, failStatus, failResponse, failHeaders }) => {
          expect(failStatus).toBe(500);
          expect(failResponse).toBe("my-custom-error");
          expect(context.headers.get("authentication")).toBe("Bearer secretPassword");
          expect(failHeaders["Content-Length"][0]).toBe("45");
          finishState.finish();
          return;
        },
      });
    },
    {
      timeout: 10_000,
    }
  );

  test(
    "call failure",
    async () => {
      const failingResponse = "failing-response";
      const payload = "my-payload";
      const thirdPartyServer = serve({
        async fetch(request) {
          const requestPayload = await request.json();
          return new Response(`${failingResponse} - ${requestPayload}`, { status: 400 });
        },
        port: THIRD_PARTY_PORT,
      });

      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 4,
        waitFor: 7000,
        initialPayload: payload,
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;
          const { status, body, header } = await context.call<string>("failing call", {
            url: LOCAL_THIRD_PARTY_URL,
            body: input,
            method: "POST",
          });
          expect(status).toBe(400);
          expect(body).toBe(`${failingResponse} - ${payload}`);
          expect(header["Content-Length"]).toEqual(["29"]);
          finishState.finish();
        },
      });

      thirdPartyServer.stop();
    },
    {
      timeout: 8000,
    }
  );

  test(
    "retry",
    async () => {
      const finishState = new FinishState();
      let counter = 0;

      await testEndpoint({
        finalCount: 4,
        waitFor: 20_000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;

          expect(input).toBe("my-payload");

          await context.run("step1", () => {
            counter += 1;
            throw new Error("my-custom-error");
          });
        },
        retries: 1,
        failureFunction: ({ context, failStatus, failResponse, failHeaders }) => {
          expect(failStatus).toBe(500);
          expect(failResponse).toBe("my-custom-error");
          expect(context.headers.get("authentication")).toBe("Bearer secretPassword");
          expect(failHeaders["Content-Length"][0]).toBe("45");
          finishState.finish();
          return;
        },
      });
      expect(counter).toBe(2);
    },
    {
      timeout: 22_000,
    }
  );

  test(
    "unicode payload",
    async () => {
      const finishState = new FinishState();
      const payload = "“unicode-quotes”";
      await testEndpoint({
        finalCount: 3,
        waitFor: 5000,
        initialPayload: payload,
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;

          expect(input).toBe(payload);

          const result = await context.run("step1", () => {
            return `result: ${input}`;
          });

          expect(result).toBe(`result: ${payload}`);
          finishState.finish();
        },
      });
    },
    {
      timeout: 7000,
    }
  );

  describe("wait for event", () => {
    const runResult = "run-result";
    const testWaitEndpoint = async (expectedWaitResponse: WaitStepResponse, eventId: string) => {
      const finishState = new FinishState();
      const payload = "my-payload";
      await testEndpoint({
        finalCount: 7,
        waitFor: 15_000,
        initialPayload: payload,
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;

          expect(input).toBe(payload);

          const { eventData, timeout } = await context.waitForEvent(
            "single wait for event",
            eventId,
            { timeout: 1 }
          );
          expect(eventData).toBeUndefined();
          expect(timeout).toBeTrue();

          const [runResponse, waitResponse] = await Promise.all([
            context.run("run-step", () => runResult),
            context.waitForEvent("wait-event-step", eventId, { timeout: 3 }),
          ]);
          expect(runResponse).toBe(runResult);
          expect(waitResponse.timeout).toBe(expectedWaitResponse.timeout);
          expect(waitResponse.eventData).toEqual(expectedWaitResponse.eventData);
          expect(typeof waitResponse.eventData).toBe(typeof expectedWaitResponse.eventData);
          finishState.finish();
        },
      });
    };

    test(
      "should timeout correctly",
      async () => {
        const eventId = `my-event-id-${nanoid()}`;
        await testWaitEndpoint(
          {
            eventData: undefined,
            timeout: true,
          },
          eventId
        );
      },
      { timeout: 17_000 }
    );

    test(
      "should notify correctly",
      async () => {
        const eventId = `my-event-id-${nanoid()}`;
        const eventData = "notify-body";
        const workflowClient = new Client({
          baseUrl: process.env.MOCK_QSTASH_URL,
          token: process.env.MOCK_QSTASH_TOKEN ?? "",
        });

        const notifyFinishState = new FinishState();
        async function retryUntilFalse(): Promise<void> {
          // wait to avoid notifying the first waitForEvent
          await new Promise((resolve) => setTimeout(resolve, 3000));

          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const result = await workflowClient.notify({ eventId, eventData });
            if (result) {
              expect(result[0].waiter.url).toBe(`http://localhost:${WORKFLOW_PORT}`);
              notifyFinishState.finish();
              break;
            }
          }
        }
        retryUntilFalse();

        await testWaitEndpoint(
          {
            eventData,
            timeout: false,
          },
          eventId
        );

        notifyFinishState.check();
      },
      { timeout: 17_000 }
    );

    describe("should notify from inside a function", () => {
      const testNotifyWithContext = async (payload: unknown) => {
        const eventId = `my-event-id-${nanoid()}`;

        const waitingEndpoint = testWaitEndpoint(
          {
            eventData: payload,
            timeout: false,
          },
          eventId
        );

        const finishState = new FinishState();
        const notifyingEndpoint = testEndpoint({
          finishState,
          initialPayload: undefined,
          waitFor: 15000,
          port: "3002",
          routeFunction: async (context) => {
            // wait to avoid notifying the first waitForEvent
            await context.sleep("sleep for first timeout", 3);

            while (true) {
              const waiters = await context.run("check waiters", async () => {
                const waiters = await makeGetWaitersRequest(context.qstashClient.http, eventId);
                return waiters;
              });

              expect(waiters[0].timeoutUrl).toBe("http://localhost:3000");
              expect(waiters[0].timeoutBody).toBe(undefined);
              expect(waiters[0].timeoutHeaders["Upstash-Workflow-Runid"]).toBeTruthy();

              if (waiters) {
                break;
              }
            }
            const { notifyResponse } = await context.notify("notify-step", eventId, payload);
            expect(notifyResponse.length).toBeTruthy();
            finishState.finish();
          },
        });

        await Promise.all([waitingEndpoint, notifyingEndpoint]);
      };

      test(
        "should handle string event data",
        async () => {
          await testNotifyWithContext("event-data");
        },
        { timeout: 170000 }
      );

      test(
        "should handle object event data",
        async () => {
          await testNotifyWithContext({ event: "data" });
        },
        { timeout: 170000 }
      );
    });
  });

  test(
    "cancel workflow",
    async () => {
      const finishState = new FinishState();
      await testEndpoint({
        finalCount: 3,
        waitFor: 7000,
        initialPayload: "my-payload",
        finishState,
        routeFunction: async (context) => {
          const input = context.requestPayload;
          expect(input).toBe("my-payload");

          await context.sleep("sleep", 1);

          finishState.finish();
          await context.cancel();

          throw new Error("shouldn't reach here");
        },
      });
    },
    {
      timeout: 10_000,
    }
  );

  describe.skip("lazy fetch", () => {
    // create 5 mb payload.
    // lazy fetch will become enabled for payloads larger than 3mb
    const largeObject = "x".repeat(4 * 1024 * 1024);

    test(
      "large payload",
      async () => {
        const finishState = new FinishState();
        await testEndpoint({
          finalCount: 3,
          waitFor: 7000,
          initialPayload: largeObject,
          finishState,
          routeFunction: async (context) => {
            const input = context.requestPayload;

            expect(input).toBe(largeObject);

            const result = await context.run("step1", async () => {
              return "step-1-result";
            });
            expect(result).toBe("step-1-result");

            finishState.finish();
          },
        });
      },
      {
        timeout: 10_000,
      }
    );
    test(
      "large parallel step response",
      async () => {
        const finishState = new FinishState();
        await testEndpoint({
          finalCount: 11,
          waitFor: 7000,
          initialPayload: "my-payload",
          finishState,
          routeFunction: async (context) => {
            const input = context.requestPayload;

            expect(input).toBe("my-payload");

            const results = await Promise.all([
              context.run("step1", () => {
                return largeObject;
              }),
              context.sleep("sleep1", 1),
              context.run("step2", () => {
                return largeObject;
              }),
              context.sleep("sleep2", 1),
            ]);

            expect(results[0]).toBe(largeObject);
            expect(results[1]).toBe(undefined);
            expect(results[2]).toBe(largeObject);
            expect(results[3]).toBe(undefined);

            await context.sleep("check", 1);

            finishState.finish();
          },
        });
      },
      {
        timeout: 10_000,
      }
    );

    test.skip(
      "large error",
      async () => {
        const finishState = new FinishState();
        await testEndpoint({
          finalCount: 3,
          waitFor: 7000,
          initialPayload: "my-payload",
          finishState,
          retries: 0,
          routeFunction: async (context) => {
            const input = context.requestPayload;

            expect(input).toBe("my-payload");

            await context.run("step1", async () => {
              throw new Error(largeObject);
            });
          },
          failureFunction({ failResponse }) {
            expect(failResponse).toBe(largeObject);
            finishState.finish();
          },
        });
      },
      {
        timeout: 10_000,
      }
    );

    test(
      "large call response",
      async () => {
        const thirdPartyServer = serve({
          async fetch() {
            return new Response(largeObject, { status: 200 });
          },
          port: THIRD_PARTY_PORT,
        });

        const finishState = new FinishState();
        await testEndpoint({
          finalCount: 6,
          waitFor: 9000,
          initialPayload: "my-payload",
          finishState,
          routeFunction: async (context) => {
            // sleeping to avoid checking input before the first step
            await context.sleep("sleeping", 1);

            const input = context.requestPayload;
            expect(input).toBe("my-payload");

            const { status, body } = await context.call("call to large object", {
              url: LOCAL_THIRD_PARTY_URL,
              body: input,
              method: "POST",
            });

            expect(status).toBe(200);
            expect(body).toBe(largeObject);

            await context.sleep("sleep", 1);

            finishState.finish();
          },
        });

        thirdPartyServer.stop();
      },
      {
        timeout: 10_000,
      }
    );
  });
});
