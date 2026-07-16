# Order Service

A small service that accepts customer orders and forwards them to the fulfillment queue.

## Architecture

The service exposes a REST API built with Express. Incoming orders are validated
with Zod and published to a message queue for asynchronous fulfillment.

## Deployment

Production deployments require a passing test suite and a manual approval step
before the pipeline promotes the build to production.

## Testing

Unit tests run with Vitest on every pull request.
