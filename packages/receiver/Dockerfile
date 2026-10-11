FROM node:24.21.0-alpine
WORKDIR /app
COPY dist/receiver.cjs ./
USER 1000
EXPOSE 8080
CMD ["node", "--no-deprecation", "receiver.cjs"]
