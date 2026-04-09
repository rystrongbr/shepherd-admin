FROM node:20-slim

# Install dependencies needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDeps needed for build)
RUN npm ci

# Copy source
COPY . .

# Build the app
RUN npm run build

# Expose port
EXPOSE 5000

# Start
CMD ["npm", "start"]
