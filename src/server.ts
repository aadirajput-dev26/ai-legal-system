import { App } from "./app";
import { config } from "./lib/config";

const fastify = App();
async function main(): Promise<void>{
    const app = App();
    await app.listen({
        port : config.PORT,
        host : '0.0.0.0',
    })
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
})