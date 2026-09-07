import { App } from "./app.js";
import { config } from "./lib/config.js";
import { startHearingWorker } from "./workers/hearing.worker.js";
import { startLegalUpdateWorker } from "./workers/legal-update.worker.js";

async function main(): Promise<void>{
    const app = App();
    await app.listen({
        port : config.PORT,
        host : '0.0.0.0',
    });

    // Start background workers after server is ready
    startHearingWorker();
    startLegalUpdateWorker();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
})