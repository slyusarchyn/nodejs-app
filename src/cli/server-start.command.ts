import { injectable } from "inversify";
import https from 'https';
import http from 'http';
import express, { Express, Request, Response } from "express";
import { AppConfig } from "../config/app.config";
import { Logger } from "../infrastructure/logger";
import { Command } from "commander";
import { container } from "../config/container.config";
import HealthCheckController from "../http/controller/api/health-check.controller";
import { DataSource } from "typeorm";
import AuthJwtMiddleware from "../http/middleware/auth-jwt.middleware";
import LogMiddleware from "../http/middleware/log.middleware";
import * as fs from "node:fs";

@injectable()
class ServerStartCommand {
  constructor(
    private readonly appConfig: AppConfig,
    private readonly logger: Logger,
  ) {
  }

  public register(program: Command): void {
    program.command('server:start')
      .option('-S, --https', 'Secure')
      .description('Start HTTP/HTTPS server')
      .action(async (args) => {
        const https = Boolean(args.https);

        await this.execute(https);
      });
  }

  public async execute(secured: boolean): Promise<void> {
    const app: Express = express();

    container.get(LogMiddleware).bind(app);

    app.use(async (req: Request, res: Response, next) => {
      const dataSource = container.get(DataSource);

      if (!dataSource.isInitialized) {
        await dataSource.initialize();
      }

      next();
    });

    const apiPublicRouter = express.Router()
    const apiPrivateRouter = express.Router()
    apiPublicRouter.use(express.json());
    apiPrivateRouter.use(express.json());

    container.get(AuthJwtMiddleware).bind(apiPrivateRouter);

    await container.get(HealthCheckController).registerRoute(apiPublicRouter);

    app.use(apiPublicRouter);
    app.use(apiPrivateRouter);

    let server: http.Server | https.Server;

    if (secured) {
      if (undefined === this.appConfig.sslKeyPath) {
        throw new Error('SSL key path not defined');
      }

      if (undefined === this.appConfig.sslCertPath) {
        throw new Error('SSL crt path not defined');
      }

      server = https.createServer({
        key: fs.readFileSync(this.appConfig.sslKeyPath),
        cert: fs.readFileSync(this.appConfig.sslCertPath),
        minVersion: "TLSv1.2",
      }, app);
    } else {
      server = http.createServer({}, app);
    }

    server.listen(this.appConfig.appPort.getValue(), this.appConfig.appHost, () => {
      const protocol = secured ? 'https' : 'http';

      this.logger.info(`Server is running at ${protocol}://${this.appConfig.appHost}:${this.appConfig.appPort.getValue()}`);
    });
  }
}

export { ServerStartCommand };
