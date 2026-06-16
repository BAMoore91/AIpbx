# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build-time env vars
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_SIP_WSS_URL
ARG VITE_STUN_URL
ARG VITE_TURN_URL
ARG VITE_TURN_USERNAME
ARG VITE_TURN_CREDENTIAL

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_SIP_WSS_URL=$VITE_SIP_WSS_URL
ENV VITE_STUN_URL=$VITE_STUN_URL
ENV VITE_TURN_URL=$VITE_TURN_URL
ENV VITE_TURN_USERNAME=$VITE_TURN_USERNAME
ENV VITE_TURN_CREDENTIAL=$VITE_TURN_CREDENTIAL

# Install deps from the lockfile (reproducible; fails if lock is out of sync).
COPY package.json package-lock.json ./
RUN npm ci

# Build
COPY . .
RUN npm run build

# ---- Stage 2: Serve ----
FROM nginx:1.25-alpine AS production

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf.bak

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
