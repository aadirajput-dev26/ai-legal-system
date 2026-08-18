import Fastify from 'fastify';
import cors from '@fastify/cors';     
import { config } from './lib/config';

export const App = () =>  {
    const app = Fastify({
        logger: {
            level: config.LOG_LEVEL
        }
    });

    app.get("/", () => {
        return {
            success : true,
            health : "ok",
            message : "Server running successfully on the port ..."
        }
    });

    return app;
}
