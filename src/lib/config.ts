import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
    PORT         : z.coerce.number().default(8080),
    LOG_LEVEL    : z.string().default('info'),
    DATABASE_URL : z.string().url(),
    JWT_ACCESS_SECRET  : z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
    JWT_REFRESH_SECRET : z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
    HIPPOCAMPUS_HOST_URL : z.string().url(),
    GTWY_PAUTHKEY        : z.string().min(1),
    GTWY_UNIVERSAL_AGENT_ID : z.string().min(1),
    NOTIFICATION_WEBHOOK_URL : z.string().url().optional(),
    VIASOCKET_ACCESS_KEY     : z.string().optional(),
    VIASOCKET_ORG_ID         : z.string().optional(),
    VIASOCKET_PROJECT_ID     : z.string().optional(),
});

export const config = env.parse(process.env);