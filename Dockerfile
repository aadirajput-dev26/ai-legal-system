#======================================================================
# Backend Dockerfile – builds TypeScript and runs the compiled server
#======================================================================

# 1️⃣ Use the official Node LTS image (alpine for small size)
FROM node:20-alpine AS builder

# Set working directory inside the container
WORKDIR /app

# Copy only package files first – leverage Docker layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install production + dev dependencies (needed for tsc)
RUN npm ci

# Copy the rest of the source code
COPY src ./src
COPY run-migration.mjs ./

# 2️⃣ Build the TypeScript sources
RUN npm run build   # runs `tsc` → outputs to ./dist

# --------------------------------------------------------------------
# Runtime stage – only the compiled code + runtime deps
# --------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy only the compiled output and runtime dependencies
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY run-migration.mjs ./
COPY db ./db
COPY email ./email

# Install only production dependencies (skip dev)
RUN npm ci --omit=dev

# Expose the API port (adjust if your server uses a different port)
EXPOSE 3000

# Use the proper entry point – npm start (which runs migrations then the server)
CMD ["npm", "start"]
