#!/usr/bin/env bash

# Medplum Docker Build Script
# This script builds all necessary components and creates Docker images for local development
# Usage: ./build-docker.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

echo "================================================"
echo "Medplum Docker Build Script"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build all packages
echo -e "${BLUE}[1/4] Building all packages with npm...${NC}"
npm run build
echo -e "${GREEN}✓ Packages built successfully${NC}"
echo ""

# Step 2: Create server tarball and build server image
echo -e "${BLUE}[2/4] Building server Docker image...${NC}"
echo "  Creating server tarball..."
tar \
  --no-xattrs \
  --exclude='*.ts' \
  --exclude='*.tsbuildinfo' \
  -czf medplum-server.tar.gz \
  LICENSE.txt \
  NOTICE \
  package.json \
  package-lock.json \
  packages/bot-layer/package.json \
  packages/ccda/package.json \
  packages/ccda/dist \
  packages/core/package.json \
  packages/core/dist \
  packages/definitions/package.json \
  packages/definitions/dist \
  packages/fhir-router/package.json \
  packages/fhir-router/dist \
  packages/server/package.json \
  packages/server/dist

echo "  Building Docker image..."
docker build -t medplum-server:local . -q
echo -e "${GREEN}✓ Server image built: medplum-server:local${NC}"
echo ""

# Step 3: Create app tarball and build app image
echo -e "${BLUE}[3/4] Building app Docker image...${NC}"
echo "  Creating app tarball..."
tar \
  --no-xattrs \
  -czf ./packages/app/medplum-app.tar.gz \
  -C packages/app/dist .

echo "  Building Docker image..."
cd packages/app
docker build -t medplum-app:local . -q
cd ../..
echo -e "${GREEN}✓ App image built: medplum-app:local${NC}"
echo ""

# Step 4: Clean up tarballs
echo -e "${BLUE}[4/4] Cleaning up...${NC}"
rm -f medplum-server.tar.gz
rm -f packages/app/medplum-app.tar.gz
echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

# Summary
echo "================================================"
echo -e "${GREEN}Build completed successfully!${NC}"
echo "================================================"
echo ""
echo "Docker images created:"
echo "  • medplum-server:local"
echo "  • medplum-app:local"
echo ""
echo "Next steps:"
echo "  docker compose down"
echo "  docker compose up -d"
echo ""
echo "Or run all in one command:"
echo -e "  ${YELLOW}./build-docker.sh && docker compose down && docker compose up -d${NC}"
echo ""
