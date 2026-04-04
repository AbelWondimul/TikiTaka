# Stage 1: Build the Next.js app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for monorepo context if needed, 
# but for static export we can just build inside the app dir if self-contained.
# Let's assume we build from the root for workspace support.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/

# Install dependencies
RUN npm install

# Copy source
COPY apps/web ./apps/web

# Build the app (static export)
WORKDIR /app/apps/web
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy the static export from builder
COPY --from=builder /app/apps/web/out /usr/share/nginx/html

# Copy custom nginx config if needed, or use default
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
