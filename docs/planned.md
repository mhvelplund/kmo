# Planned work

This page says what is planned for KMO and not built, and what each piece of work must still prove. None of it is
designed yet. Each piece needs a spec before a plan.

The proof inside EKS and the AWS integration are done: [the demo on AWS](aws-demo.md) builds them with Terraform and
Terragrunt and checks them with `mise run test:aws`. Other kinds of store and a forced reload of a store come next.

Two things are not planned: HTTPS inside the receiver, and a certificate from the cluster with a domain. HTTPS ends at
API Gateway: see the [design](design.md#decisions-and-their-reasons).

## Other kinds of store

A store is a bucket today. Stores for AWS Systems Manager Parameter Store and AWS Secrets Manager are planned. Each will
be a block next to `s3` in the store.

The design fixes four rules for them, so that each new kind is an addition and not a change:
[Other kinds of store](design.md#other-kinds-of-store). One rule is already in the receiver: it answers an EventBridge
event from a source other than `aws.s3` with 200 and ignores it, because the new kinds will announce their changes
through EventBridge too.

## Forced reload of a store

A person can ask for a sync of one ConfigSync today, by setting the sync annotation on it. There is no way to ask for a
sync of every ConfigSync that reads one store. When a change event is lost, for example while the receiver is down, each
of those ConfigSyncs gets the change only when its refresh interval has passed, which is after 30 minutes by default. A
forced reload gives a ConfigStore and a ClusterConfigStore one action that syncs all their ConfigSyncs at once.

Two rules are fixed. The request ends as the sync annotation on each ConfigSync, so there is still one path into a
reconcile. A suspended ConfigSync is skipped. Because the hash is the stamp, a forced reload restarts only the workloads
whose values changed.

The spec must settle the form of the request, which could be the same annotation on the store, and who may make it on a
ClusterConfigStore, where one request syncs ConfigSyncs in many namespaces.

## Authentication of the receiver with OAuth

The receiver knows one shared token today. That token does not expire, and a person must change it by hand. OAuth gives
EventBridge a token that lives for about an hour, from a standard exchange.

EventBridge cannot prove its own identity to an HTTP address. A connection knows three methods only: Basic, an API key,
and OAuth client credentials. It cannot sign a request with SigV4, it cannot send a client certificate, and it cannot
send an identity token that AWS signs. Of the three methods, OAuth client credentials is the nearest to OIDC:

1. The connection holds a client ID and a client secret.
2. EventBridge sends them to the token address of an authorization server and gets an access token, which is a JWT.
3. EventBridge sends the JWT in the header `Authorization: Bearer <jwt>`. It gets a new token when the old one is about
   to expire, and after an answer of 401.

The proposal:

- **The authorization server is Amazon Cognito.** A user pool with a domain, a resource server with one scope for the
  events, and an app client that may use the grant of client credentials. Terraform makes all of them.
- **API Gateway checks the JWT.** The HTTP API of [the demo on AWS](aws-demo.md) in front of the receiver is where this
  goes. It has a JWT authorizer, with the issuer of the user pool, the app client as the audience, and the scope of the
  events. A request with a bad or expired token stops at API Gateway and does not get into the VPC. The receiver needs
  no change.
- **The shared token stays.** A connection can add more headers to each call, so EventBridge sends the receiver's token
  too. The local RustFS can send only a fixed token, so the receiver keeps one way to check a caller for all stores.

The work must settle these points:

- **Is it worth it?** The client secret is a secret that does not expire, in place of the token. The gain is small,
  because the most that a caller can do is ask for a sync, and a sync that finds the same values restarts nothing.
- **A check in the receiver.** The receiver could check the JWT itself, so that it does not depend on API Gateway. That
  is a change to the code: a JWT library, a cache of the keys of the issuer, and an outbound path from the receiver to
  the issuer. It also gives the receiver two ways to check a caller.

## Open points

- **Several copies of the operator in one cluster.** An early experiment suggested that Pepr modules with different
  identifiers can share a cluster, all in `pepr-system`. That was read from the names that Pepr generates, not from the
  Pepr documentation. Confirm it in the documentation before anything depends on it.

## Read next

- [Known limits](limits.md) for what KMO does not do today.
- The [design](design.md) for the scope and the reason for each decision.
