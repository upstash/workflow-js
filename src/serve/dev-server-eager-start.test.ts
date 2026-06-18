/**
 * Pins the eager-start regression (DX-2705): defining a workflow route by
 * calling an adapter's `serve()` / `serveMany()` factory must start the QStash
 * dev server *synchronously at factory-call time* — NOT deferred to the first
 * inbound request, which is how every lazy adapter behaved before this change.
 *
 * We assert at the `@upstash/qstash` boundary by mocking `startDevServer`, the
 * single call each adapter makes. (Prior art for the "drive the public entry,
 * assert at the qstash boundary" approach: multi-region/multi-region.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realQstash from "@upstash/qstash";

const startDevServer = mock(() => Promise.resolve());

// Keep the real Client/Receiver/etc.; only intercept startDevServer. Registered
// before the adapters are imported (below) so they pick up the mocked export.
void mock.module("@upstash/qstash", () => ({
  ...realQstash,
  startDevServer,
}));

// Import the adapters dynamically AFTER the mock is registered.
const hono = await import("../../platforms/hono");
const cloudflare = await import("../../platforms/cloudflare");
const express = await import("../../platforms/express");
const svelte = await import("../../platforms/svelte");
const h3 = await import("../../platforms/h3");
const solidjs = await import("../../platforms/solidjs");
const astro = await import("../../platforms/astro");
const tanstack = await import("../../platforms/tanstack");
const nextjs = await import("../../platforms/nextjs");
const reactRouter = await import("../../platforms/react-router");
const baseServe = await import("./index");

const routeFunction = async () => {};

// Every public serve-like factory should start the dev server when the route is
// defined. `defineRoute` calls the factory but never invokes the returned
// request handler — so a passing assertion proves the start was NOT deferred.
const factories: { name: string; defineRoute: () => unknown }[] = [
  { name: "hono.serve", defineRoute: () => hono.serve(routeFunction) },
  { name: "cloudflare.serve", defineRoute: () => cloudflare.serve(routeFunction) },
  { name: "express.serve", defineRoute: () => express.serve(routeFunction) },
  { name: "svelte.serve", defineRoute: () => svelte.serve(routeFunction, { env: {} }) },
  { name: "h3.serve", defineRoute: () => h3.serve(routeFunction) },
  { name: "solidjs.serve", defineRoute: () => solidjs.serve(routeFunction) },
  { name: "astro.serve", defineRoute: () => astro.serve(routeFunction) },
  { name: "tanstack.serve", defineRoute: () => tanstack.serve(routeFunction) },
  { name: "nextjs.serve", defineRoute: () => nextjs.serve(routeFunction) },
  { name: "nextjs.servePagesRouter", defineRoute: () => nextjs.servePagesRouter(routeFunction) },
  { name: "reactRouter.serve", defineRoute: () => reactRouter.serve(routeFunction) },
  { name: "serve (framework-agnostic root)", defineRoute: () => baseServe.serve(routeFunction) },
];

// serveMany factories. For most adapters serveMethod is the adapter `serve`, so
// they are covered transitively; express is the exception (its serveMethod is an
// internal handler, not `serve`) and so starts the dev server in serveMany itself.
const serveManyFactories: { name: string; defineRoutes: () => unknown }[] = [
  {
    name: "hono.serveMany",
    defineRoutes: () => hono.serveMany({ wf: hono.createWorkflow(routeFunction) }),
  },
  {
    name: "express.serveMany",
    defineRoutes: () => express.serveMany({ wf: express.createWorkflow(routeFunction) }),
  },
  {
    name: "nextjs.serveMany",
    defineRoutes: () => nextjs.serveMany({ wf: nextjs.createWorkflow(routeFunction) }),
  },
  {
    name: "nextjs.serveManyPagesRouter",
    defineRoutes: () =>
      nextjs.serveManyPagesRouter({ wf: nextjs.createWorkflowPagesRouter(routeFunction) }),
  },
];

describe("adapters eagerly start the QStash dev server on serve()", () => {
  let prevQstashDev: string | undefined;

  beforeEach(() => {
    // Eager adapters (nextjs, react-router) construct a real Client in serve();
    // make sure a machine-level QSTASH_DEV=true doesn't make that real Client
    // spawn an actual dev server during this unit test.
    prevQstashDev = process.env.QSTASH_DEV;
    delete process.env.QSTASH_DEV;
    startDevServer.mockClear();
  });

  afterEach(() => {
    if (prevQstashDev === undefined) delete process.env.QSTASH_DEV;
    else process.env.QSTASH_DEV = prevQstashDev;
  });

  for (const { name, defineRoute } of factories) {
    test(`${name} starts the dev server synchronously at factory-call time`, () => {
      expect(startDevServer).not.toHaveBeenCalled();
      defineRoute();
      // Synchronously after defining the route and before any inbound request.
      expect(startDevServer).toHaveBeenCalledTimes(1);
    });
  }

  for (const { name, defineRoutes } of serveManyFactories) {
    test(`${name} starts the dev server at setup time`, () => {
      expect(startDevServer).not.toHaveBeenCalled();
      defineRoutes();
      expect(startDevServer).toHaveBeenCalled();
    });
  }
});
