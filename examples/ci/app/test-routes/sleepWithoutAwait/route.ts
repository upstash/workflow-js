import { serve } from "@upstash/workflow/nextjs";
import { BASE_URL } from "app/ci/constants";
import { testServe, expect } from "app/ci/utils";
import { saveResult } from "app/ci/upstash/redis"

type Invoice = {
  date: number;
  email: string;
  amount: number;
};

type Charge = {
  invoice: Invoice;
  success: boolean;
  counter: number
};

const header = `test-header-foo`
const headerValue = `header-bar`
const payload: Invoice = { date: 123, email: "my@mail.com", amount: 10 }

const attemptCharge = (counter: number) => {
  counter += 1;
  if (counter === 3) {
    counter = 0;
    return { success: true, counter };
  }
  return { success: false, counter };
};

export const { POST, GET } = testServe(
  serve<Invoice>(
    async (context) => {
      const invoice = context.requestPayload;

      expect(typeof invoice, typeof payload);
      expect(JSON.stringify(invoice), JSON.stringify(payload));

      let charge: Charge = {
        success: false,
        counter: 0,
        invoice
      }

      for (let index = 0; index < 3; index++) {
        charge = await context.run("attemptCharge", () => {
          const { success, counter } = attemptCharge(charge.counter);
          const newCharge: Charge = { invoice, success, counter };
          return newCharge;
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
            context,
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
      retries: 0
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
