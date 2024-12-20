import { resend } from "@upstash/qstash";
import { ApiCallSettings, BaseWorkflowApi } from "./base";
import { CallResponse } from "../../types";

type SendEmail = {
  from: string;
  to: string;
  subject: string;
  bcc?: string | string[];
  cc?: string | string[];
  scheduled_at?: string;
  reply_to?: string | string[];
  html?: string;
  text?: string;
  headers: unknown;
  attachments: unknown;
  tags: { name: string; value: string }[];
};
type SendEmailResponse = {
  id: string;
};

type SendBatchEmail = SendEmail[];
type SendBatchEmailResponse = {
  data: SendEmailResponse[];
};

export class ResendAPI extends BaseWorkflowApi {
  public async call<
    TBatch extends boolean = false,
    TResult = TBatch extends true ? SendBatchEmailResponse : SendEmailResponse,
    TBody = TBatch extends true ? SendBatchEmail : SendEmail,
  >(
    stepName: string,
    settings: ApiCallSettings<
      TBody,
      {
        token: string;
        batch?: TBatch;
      }
    >
  ): Promise<CallResponse<TResult>> {
    const { token, batch = false, ...parameters } = settings;
    return await this.callApi<TResult, TBody>(stepName, {
      api: {
        name: "email",
        provider: resend({ token, batch }),
      },
      ...parameters,
    });
  }
}
