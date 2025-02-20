#Boilerplate Dockerfile for XTR_defi_backend @d0ra-1h3-3xpl0ra fix this
# Use a Node base image that suits your chosen version
FROM node:20-alpine

WORKDIR /app

# Copy only package files first to cache layers
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# Now copy the rest of the project
COPY . .

# Build TypeScript
RUN pnpm build

# Expose port (if needed)
EXPOSE 3000

# Run the app
CMD ["pnpm", "start"]
