import { PublishRequest } from "@upstash/qstash";
import { WorkflowError } from "../error";

/**
 * copies and updates the request by removing the api field and adding url & headers.
 *
 * @param api api field of PublishRequest
 * @returns updated request
 */
export const getProviderInfo = (api: Required<PublishRequest>["api"]) => {
  if (!api.provider) {
    throw new WorkflowError("A Provider must be provided.");
  }
  if (api.provider.owner === "upstash") {
    throw new WorkflowError("Upstash provider isn't supported.");
  }

  const { name, provider, ...parameters } = api;

  // validate provider
  if (!provider.baseUrl) throw new TypeError("baseUrl cannot be empty or undefined!");
  if (!provider.token) throw new TypeError("token cannot be empty or undefined!");
  if (provider.apiKind !== name) {
    throw new TypeError(`Unexpected api name. Expected '${provider.apiKind}', received ${name}`);
  }

  const providerInfo = {
    url: provider.getUrl(),
    baseUrl: provider.baseUrl,
    route: provider.getRoute(),
    appendHeaders: provider.getHeaders(parameters),
    owner: provider.owner,
    method: provider.method,
  };

  return provider.onFinish(providerInfo, parameters);
};
