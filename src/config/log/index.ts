import pino, { TransportTargetOptions } from "pino";
import envVars from "../env";

const targets: Array<TransportTargetOptions> = [
  {
    target: "pino-roll",
    options: {
      file: `${envVars.LOG_DIR}/sandbox`,
      frequency: "daily",
      maxSize: "10m",
      maxFiles: 7,
      mkdir: true,
    },
    level: envVars.LOG_LEVEL,
  },
];

if (envVars.ENV_MODE === "DEV") {
  targets.push({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
    level: envVars.LOG_LEVEL,
  });
}

const transport = pino.transport({ targets });

const logger = pino(
  {
    level: envVars.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

export default logger;
