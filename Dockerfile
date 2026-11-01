# Production multi-stage or lightweight Node Alpine container
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (leverages Docker layer cache)
COPY package*.json ./

RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose server port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root user for security
USER node

CMD ["node", "server.js"]

