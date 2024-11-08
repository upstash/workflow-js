import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL, CI_RANDOM_ID_HEADER } from "app/ci/constants";
import { testServe, expect, nanoid } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

type Invoice = {
  date: number;
  email: string;
  amount: number;
};

type Charge = {
  invoice: Invoice;
  success: boolean;
};

const header = `test-header-${nanoid()}`
const headerValue = `header-${nanoid()}`
const payload: Invoice = { date: 123, email: "my@mail.com", amount: 10 }

let counter = 0;
const attemptCharge = () => {
  counter += 1;
  if (counter === 3) {
    counter = 0;
    return true;
  }
  return false;
};

export const { POST, GET } = testServe(
  serve<Invoice>(
    async (context) => {
      const invoice = context.requestPayload;

      expect(typeof invoice, typeof payload);
      expect(JSON.stringify(invoice), JSON.stringify(payload));

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

          expect(updateDb, 10);
          expect(receipt, "my@mail.com");
          expect(sleepResult, undefined);
          
          await saveResult(
            "sleepWithoutAwait",
            context.headers.get(CI_RANDOM_ID_HEADER),
            "foobar"
          )
          
          return;
        }
        await context.sleep("retrySleep", 2);
      }
      await context.run("paymentFailed", () => {
        return true;
      });
    }, {
      baseUrl: BASE_URL,
      retries: 1
    }
  ), {
    expectedCallCount: 13,
    expectedResult: "foobar",
    payload,
    headers: {
      [ header ]: headerValue
    }
  }
) 