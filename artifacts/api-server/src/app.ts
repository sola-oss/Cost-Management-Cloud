import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { requireAuth } from "./middlewares/auth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", requireAuth, router);

// 本番（Railway等）：ビルドしたフロントを同一ドメインで配信する。
// FRONTEND_DIST が未指定なら api-server/dist から見た genka-kanri/dist を既定にする。
// dist が存在しない開発環境（Viteがフロントを配信）では何もしない。
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = process.env["FRONTEND_DIST"]
  ?? path.resolve(here, "../../genka-kanri/dist/public");

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  // API以外のGETはSPAのindex.htmlを返す（クライアントルーティング対応）
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"), (err) => {
      if (err) next();
    });
  });
  logger.info({ frontendDist }, "Serving frontend from dist");
}

export default app;
