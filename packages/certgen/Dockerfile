FROM node:24.21.0-alpine
WORKDIR /app
COPY dist/certgen.cjs ./
USER 1000
ENTRYPOINT ["node", "--no-deprecation", "certgen.cjs"]
