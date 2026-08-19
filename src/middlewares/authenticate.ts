import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * authenticate middleware
 * Verifies the JWT Access Token from the Authorization: Bearer header.
 * Sets req.user = { userId, email, name } on success.
 */
export async function authenticate(
    req: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    try {
        await req.jwtVerify();
    } catch {
        reply.code(401).send({
            success: false,
            error: {
                code   : 'UNAUTHORIZED',
                message: 'Missing or invalid access token.',
            },
        });
    }
}
