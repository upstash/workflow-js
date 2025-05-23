import { Controller, Get, Post, Req, Res, Next } from '@nestjs/common';
import { AppService } from './app.service';
import { serve } from '@upstash/workflow/express';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { Client } from '@upstash/qstash';

const someWork = (input: string) => {
  return `processed '${JSON.stringify(input)}'`;
};

@Controller()
export class AppController {
  private qstashClient: Client;

  constructor(
    private readonly appService: AppService,
    private configService: ConfigService,
  ) {
    const qstashUrl = this.configService.get<string>('QSTASH_URL');
    const qstashToken = this.configService.get<string>('QSTASH_TOKEN');
    this.qstashClient = new Client({
      baseUrl: qstashUrl,
      token: qstashToken,
    });
  }

  @Get()
  getHello(): string {
    return this.configService.get<string>('QSTASH_URL') || 'missing';
  }

  @Post('workflow')
  async upstashWorkflow(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    return serve<{ message: string }>(
      async (context) => {
        const input = context.requestPayload.message;
        const result1 = await context.run('step1', () => {
          const output = someWork(input);
          console.log('step 1 input', input, 'output', output);
          return output;
        });

        await context.run('step2', () => {
          const output = someWork(result1);
          console.log('step 2 input', result1, 'output', output);
        });
      },
      {
        qstashClient: this.qstashClient,
      },
    )(req, res, next);
  }
}
