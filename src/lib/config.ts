import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
    PORT : z.coerce.number().default(8080),
    LOG_LEVEL : z.string().default('info')
});

export const config = env.parse(process.env);