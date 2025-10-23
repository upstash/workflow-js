# Setup Instructions

## Overview

This example integrates Upstash Workflow and Realtime SDKs. There are some TypeScript errors that need to be resolved based on the actual API of the realtime SDK version being used.

## Current Issues

The Realtime SDK API appears to have changed from the README documentation. The following need to be fixed:

### 1. Hook API (`src/hooks/useWorkflowWithRealtime.tsx`)
- Line 35: `events` should possibly be `event` (singular)
- Need to verify the correct API for `useRealtime` hook

### 2. Emit API (`src/app/api/workflow/*/route.ts`)
- The emit syntax `realtime.channel(id).workflow.stepStart.emit()` doesn't match the current API
- Should probably be: `realtime.workflow.stepStart.emit()` or similar
- Check the actual Realtime SDK source or examples

### 3. Event Data Typing (`src/app/api/workflow/human-in-loop/route.ts`)
- `eventData` from `context.waitForEvent` is typed as `unknown`
- Need to add proper type assertion: `eventData as { approved: boolean }`

## Quick Fixes Needed

### Fix 1: Update realtime emit calls

Replace all instances of:
```typescript
await realtime.channel(workflowRunId).workflow.stepStart.emit({...})
```

With the correct API based on the SDK documentation. Possibilities:
```typescript
// Option A: Direct emit
await realtime.workflow.stepStart.emit({...})

// Option B: Channel method
await realtime.channel(workflowRunId).emit("workflow.stepStart", {...})

// Option C: Namespaced
const channel = realtime.channel(workflowRunId)
await channel.emit("workflow:stepStart", {...})
```

### Fix 2: Update useRealtime hook

In `src/hooks/useWorkflowWithRealtime.tsx`, change `events` to `event` if that's the correct API.

### Fix 3: Type eventData properly

In `src/app/api/workflow/human-in-loop/route.ts`:
```typescript
const { eventData, timeout } = await context.waitForEvent(...)

// Add type assertion
const data = eventData as { approved: boolean }

if (data.approved) {
  // ...
}
```

## Testing Steps

1. Check the actual Realtime SDK version:
   ```bash
   cat package.json | grep realtime
   ```

2. Look at the SDK source or examples to find the correct API

3. Run the dev server and fix TypeScript errors one by one:
   ```bash
   pnpm dev
   ```

4. Test the workflows:
   - Click "Trigger Basic Workflow"
   - Click "Trigger Human-in-Loop Workflow"
   - Approve/reject when prompted

## Environment Variables

Make sure these are set in `.env.local`:
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
```
