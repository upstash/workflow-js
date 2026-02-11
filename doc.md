## Context for worklow:
How Workflow Works

Copy page

Upstash Workflow is an orchestration layer that allows you to write multi‑step workflows which are:
Durable – steps automatically recover from errors or outages
Scalable – steps run independently and in parallel when possible
Cost‑efficient – idle waiting (delays, sleeps, external calls) does not consume compute resources
Upstash Workflow is built on top of Upstash QStash, our serverless messaging and scheduling solution, to achieve these features.
​
The Core Idea
Traditionally, backend functions are built in one of two ways: either everything is executed inside a single API function—which is difficult to maintain and prone to failures—or the flow is split across multiple APIs connected by a queueing system, which adds significant infrastructure and state‑management overhead.
These approaches can work, but they often fail to handle production load reliably or become increasingly difficult to maintain over time:
Timeouts – the whole function runs inside one execution window. A slow API can easily exceed serverless limits (often 10–60 seconds).
Temporary issues – slow or unreliable external services can exceed serverless limits or cause the entire request to fail.
Failures – if a step fails, the whole request fails. You either restart everything or you must write custom retry logic.
Rate limits – calling external APIs in bulk requires careful concurrency control, which is difficult to implement manually.
Complexity – to address these issues, teams often build custom queues, schedulers, or state trackers, adding unnecessary infrastructure overhead.
​
How Upstash Workflow Solves This
Upstash Workflow takes a different approach: instead of treating your entire function as one continuous execution, it splits your logic into multiple steps in a workflow endpoint, each managed and retried by the orchestration engine.
Each step is executed in its own HTTP call to your application.
After a step finishes, its result is stored in durable state inside Upstash Workflow.
On the next execution, Workflow skips completed steps and resumes exactly where it left off by restoring the previous step results.
If a step fails, it is retried automatically based on your retry configuration.

## Instructions

So this is the workflow project. It only works in prod. If you want to make it work in dev, you need to run  `@upstash/qstash-cli dev`, which downloads a local server that replicates the production QStash server on your local machine. Then you have to set the `QSTASH_URL` and `QSTASH_TOKEN` environment variables to the local server URL and token. Note that the local qstash token never changes, it's always the same.

Now the thing i want to do is for the user to never need the qstash-cli package at all. If in the env, user has WORKFLOW_DEV=true, then the @upstash/workflow package should download the local qstash server and use the local qstash credentials by using global variables.

But the downloading logic is like this:
```
#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import tar from "tar";
import fetch from "node-fetch";
import * as unzipper from 'unzipper';
import PJ from "./package.json";

interface BinaryConfig {
  arch: 'arm64' | 'amd64';
  platform: 'darwin' | 'linux' | 'windows';
  extension: '.tar.gz' | '.zip';
  baseUrl: string;
}

const platformMap: Partial<Record<NodeJS.Platform, BinaryConfig['platform']>> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows"
};

const archMap: Partial<Record<NodeJS.Architecture, BinaryConfig['arch']>> = {
  arm64: "arm64",
  x64: "amd64",
};

const extensionMap: Partial<Record<NodeJS.Platform, BinaryConfig['extension']>> = {
  linux: ".tar.gz",
  darwin: ".tar.gz",
  win32: ".zip",
};

class BinaryDownloader {
  private config: BinaryConfig;

  constructor(config: BinaryConfig) {
    this.config = config
  }

  private URL(): string {
    const { arch, platform, baseUrl, extension } = this.config;
    let version = PJ.version.trim()
    return `${baseUrl}/${version}/qstash-server_${version}_${platform}_${arch}${extension}`;
  }

  public async download(): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve, reject) => {
      const url = this.URL();
      fetch(url).then((res) => {
          if (res.status !== 200) {
            throw new Error(`Error downloading binary; invalid response status code: ${res.status}`);
          }
          if (!res.body) {
            return reject(new Error("No body to pipe"));
          }
          resolve(res.body);
        }).catch(reject);
    });
  }

  public async extract(stream: NodeJS.ReadableStream): Promise<void> {
    return new Promise((resolve, reject) => {
        const bin = path.resolve("./bin");
        switch (this.config.extension) {
            case ".tar.gz":
              const untar = tar.extract({ cwd: bin });
              stream
                .pipe(untar)
                .on('close', () => resolve())
                .on('error', reject)
              break;
            case ".zip":
                stream
                  .pipe(unzipper.Extract({ path: bin }))
                  .on('close', () => resolve())
                  .on('error', reject);
          }
    })
  }
}

function getSysInfo(): { arch: BinaryConfig['arch'], platform: BinaryConfig['platform'], extension: BinaryConfig['extension'] } {
    const arch = archMap[process.arch]
    const platform = platformMap[process.platform]
    const extension = extensionMap[process.platform]

    if (!platform) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    if (!arch) {
      throw new Error(`Unsupported architecture: ${process.arch}`);
    }

    if (!extension) {
      throw new Error(`Unsupported extension: ${process.platform}`);
    }

    return { arch, platform, extension };
}

(async () => {
    try {
        const { arch, platform, extension } = getSysInfo();
    
        const downloader = new BinaryDownloader({
          arch,
          platform,
          extension,
          baseUrl: 'https://artifacts.upstash.com/qstash/versions'
        });
        const stream = await downloader.download();
        await downloader.extract(stream);
      } catch (error) {
        console.error(error);
        process.exit(1);
      }
})();


```

I'm okay with not supporting windows for now, I also don't want to include the unzip or tar in dependencies of this project. Can I just use `tar` that is already installed on the system? And is it usually installed in macos and github actions?

Note that the output is like this:
Upstash QStash development server is runnning at http://127.0.0.1:8080

A default user has been created for you to authorize your requests.
QSTASH_TOKEN=eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0=
QSTASH_CURRENT_SIGNING_KEY=sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r
QSTASH_NEXT_SIGNING_KEY=sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs

Sample cURL request:
curl -X POST http://127.0.0.1:8080/v2/publish/https://example.com -H "Authorization: Bearer eyJVc2VySUQiOiJkZWZhdWx0VXNlciIsIlBhc3N3b3JkIjoiZGVmYXVsdFBhc3N3b3JkIn0="

Check out documentation for more details:
https://upstash.com/docs/qstash/howto/local-development

And it does not have the feature of picking a differnet port if this one is already taken, just uses this one all the time. You can set a custom one using --port flag.


Now I want you to add this feature to this @upstash/workflow package.