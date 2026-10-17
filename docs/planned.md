# Planned work

This page says what is planned for KMO and not built, and what each piece of work must still prove. None of it is
designed yet. Each piece needs a spec before a plan.

Two pieces of work come next: the proof inside EKS, and the AWS integration. Together they close most of the gaps in the
scope of the [design](design.md#scope). Other kinds of store and a forced reload of a store come after them.

## The proof inside EKS

KMO has a Helm chart and an example ArgoCD application, and both are proven on a local cluster:
[Installing](installing.md). It is not yet installed in a real EKS cluster.

The work must settle this point:

- **The proof inside EKS of stores without stored keys.** The path is proven from a cluster outside EKS. This work
  brings the first EKS cluster and must repeat `test/e2e/aws/setup.sh` there, without the step that publishes the
  signing keys, because EKS registers them itself. See [Stores in AWS without stored keys](aws-identity.md).

It must also decide where the images come from in EKS. The packages on GitHub are private, so a cluster needs pull
Secrets in two namespaces. A registry in AWS would need none.

## AWS integration

The AWS integration brings the Terraform and Terragrunt modules for the AWS side of KMO:

- the EventBridge rule and the connection that carry the change events of S3 to the receiver's path
  `/events/eventbridge`;
- the AWS side of a store without stored keys: the registration of a cluster's signing keys, and the IAM roles;
- HTTPS on the receiver, which speaks plain HTTP today. The receiver must support HTTPS and prefer it. EventBridge sends
  events to HTTPS addresses only, so the path from S3 cannot work without it;
- proper authentication of the receiver, which knows one shared token today. See
  [Authentication of the receiver with OAuth](#authentication-of-the-receiver-with-oauth).

It must settle these points:

- **Where HTTPS ends.** The receiver can hold the certificate itself, or an ingress or a load balancer in front of it
  can. The work must decide which, where the certificate comes from, and whether plain HTTP stays for the local
  environment only.
- **EventBridge keys.** KMO takes the key of an EventBridge event as it is, on the assumption that it is not
  URL-encoded. The AWS integration must confirm this against a live event, with a key that holds a space and a plus
  sign, and add the captured event to `packages/core/test/fixtures/`.

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
- **API Gateway checks the JWT.** The HTTP API in front of the receiver has a JWT authorizer, with the issuer of the
  user pool, the app client as the audience, and the scope of the events. A request with a bad or expired token stops at
  API Gateway and does not get into the VPC. The receiver needs no change.
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
