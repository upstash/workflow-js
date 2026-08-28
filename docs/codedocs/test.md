---
title: "Appendix: Protocol Notes"
description: "Background notes on the workflow protocol and request headers."
---

This appendix provides background about the workflow protocol used by the SDK. It is not required for day-to-day use, but it can be helpful when debugging request flows or building custom integrations.

The SDK relies on a header-based protocol to identify workflow runs, step boundaries, and invocation state. Core headers are defined in `src/constants.ts`, such as `Upstash-Workflow-RunId`, `Upstash-Workflow-Init`, and `Upstash-Workflow-Sdk-Version`. These headers allow the server to determine if a request is the initial invocation or a subsequent step replay. They also enable validation in `validateRequest` inside `src/workflow-parser.ts`.

When a workflow step is submitted, the SDK generates a header set in `src/qstash/headers.ts`. This logic merges workflow configuration (retries, flow control, failure URL), telemetry data, and user headers. Headers are then prefixed to match the destination: workflow endpoint, callback endpoint for `context.call`, or the failure callback. This prefixing is how QStash routes metadata across services without losing the original request context.

Callbacks from third-party calls are handled in `handleThirdPartyCallResult` in `src/workflow-requests.ts`. The SDK detects callback headers, reconstructs the original call response, and publishes a result step back to QStash. This ensures that external API calls are treated like any other step, with replay and deduplication handled by the same step logic.

Multi-region mode is enabled when `QSTASH_REGION` is set and no custom `WorkflowClient` is provided. In that mode, `src/serve/multi-region/handlers.ts` selects the correct regional client and receiver based on the `upstash-region` header. This keeps workflows low-latency while still preserving the same protocol semantics.

If you build your own adapter, the main requirement is to preserve the standard `Request` and `Response` shapes used by `serveBase`. As long as you forward headers, body, and URL correctly, the protocol remains intact and the workflow engine behaves consistently across platforms.

These notes can also help when debugging edge cases such as duplicate steps or mismatched step definitions after deployments.
