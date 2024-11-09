import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

const header = `test-header-${nanoid()}`
const headerValue = `header-${nanoid()}`

export const { POST, GET } = testServe(
  serve<string>(
    async (context) => {
      const input = context.requestPayload;

      expect(input, undefined);
      expect(context.headers.get(header)!, headerValue)

      const startTimeInMs = await context.run("step1", async () => {
        const timeInMs = new Date().getTime()
        return timeInMs
      });

      expect(typeof startTimeInMs, "number");

      await context.sleepUntil("sleep1", Date.now() / 1000 + 3);

      const middleTimeInMs = await context.run("step2", async () => {
        const timeInMs = new Date().getTime()
        return timeInMs
      });

      if (middleTimeInMs - startTimeInMs < 3000) {
        throw new Error("it doesn't look like sleepUntil was applied.")
      }

      await context.sleep("sleep2", 2);

      const endTimeInMs = await context.run("step3", async () => {
        const timeInMs = new Date().getTime()
        return timeInMs
      });

      if (endTimeInMs - middleTimeInMs < 2000) {
        throw new Error("it doesn't look like sleep was applied.")
      }

      await saveResult(
        context,
        "foobar"
      )
    }, {
      baseUrl: BASE_URL,
      retries: 0
    }
  ), {
    expectedCallCount: 7,
    expectedResult: "foobar",
    payload: undefined,
    headers: {
      [ header ]: headerValue
    }
  }
) 