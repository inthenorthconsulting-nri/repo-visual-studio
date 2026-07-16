# Terraform self-hosting example

This directory is a small, synthetic Terraform root module used to exercise
and demonstrate the Terraform topology engine (`@rvs/terraform-graph` and the
`rvs create topology` command) against a realistic-shaped configuration,
without depending on any real infrastructure.

**This is not deployable infrastructure.** It is safe, synthetic, offline,
and credential-free by design:

- The AMI ID (`ami-0000000000000000`) is a placeholder, not a real image.
- `admin_password`'s default (`example-not-a-real-secret`) is a literal
  marker string, not a credential.
- Running `terraform init`/`plan`/`apply` against this directory is not
  supported or intended — no backend is configured, and several resources
  reference placeholder values that would fail a real AWS validation.
- `rvs` never executes Terraform, evaluates expressions, or calls any cloud
  API against this (or any) directory — it only parses the `.tf` files as
  text via `@cdktf/hcl2json` and builds a topology from what the HCL
  literally declares.

## Purpose

This example is deliberately composed to exercise every construct class the
Terraform topology engine supports, in one small, human-readable module tree:

| Construct | Where |
| --- | --- |
| One provider (`aws`), pinned via `required_providers` | `main.tf` |
| One data source | `data.aws_availability_zones.available` |
| Explicit `depends_on` | `aws_instance.app` → `aws_subnet.secondary` |
| Static resource-to-resource references | subnets/security group/instance all reference `aws_vpc.main`; the instance references its subnet and security group |
| One local child module, fully resolved | `module.logging` → `modules/logging/` |
| One remote (registry) module, intentionally opaque | `module.shared_network` (`terraform-aws-modules/vpc/aws`) |
| One sensitive variable | `admin_password`, flowing into `aws_ssm_parameter.admin_password` |
| One intentionally dynamic expression | see below |
| One output | `vpc_id` |
| 7 managed resources at the root, 1 more inside the local child module | — |

## Relationships the topology should detect

- `calls-module`: root → `module.logging`, root → `module.shared_network`
- `contains`: `module.logging` → `aws_cloudwatch_log_group.app`
- `passes-input`: `aws_vpc.main` → `module.logging` (via the `vpc_id` input)
- `references`: `aws_subnet.primary`/`aws_subnet.secondary`/`aws_security_group.app` → `aws_vpc.main`; `aws_instance.app` → `aws_subnet.primary`, `aws_security_group.app`
- `depends-on`: `aws_instance.app` → `aws_subnet.secondary` (explicit)
- `reads-from`: `aws_subnet.primary`/`aws_subnet.secondary` → `data.aws_availability_zones.available`
- `produces-output`: `aws_vpc.main` → `output.vpc_id`
- `uses-provider`: every `aws_*` resource → the single `aws` provider node

## The intentionally dynamic expression

`aws_s3_bucket.artifacts`'s `count = var.environment == "demo" ? 1 : 0` is
the one deliberately dynamic construct in this example. Its value depends on
evaluating a variable comparison, which requires actually running Terraform —
something this project never does. The topology engine preserves this as an
**unresolved** expression (node status `dynamic`, an informational
`TERRAFORM_DYNAMIC_EXPRESSION` warning) rather than guessing whether the
bucket exists. No fabricated `count.index`-expanded resource instances are
created.

## The intentionally opaque module

`module.shared_network` points at the public Terraform Registry module
`terraform-aws-modules/vpc/aws`. This project never downloads or resolves
registry/git module sources — `rvs` represents it as a single opaque
`external-module` node (with an informational `TERRAFORM_REMOTE_MODULE_OPAQUE`
warning) and stops there. Its internal resources are never inspected, because
they aren't checked into this repository.

## Running it through `rvs`

```
rvs create topology --source examples/terraform/self-hosting --renderer both --format visualdoc
```

or, to include it alongside every other Terraform root module in the repo:

```
rvs create topology --all --renderer both --format visualdoc
```

Ordinary repository inspection (`rvs inspect`) never reads this directory —
that command's evidence scan is scoped by `.rvs/config.yml`'s
`sources.include` globs (README/docs/source/workflow/manifest files only) and
the generic scanner has no Terraform adapter at all. This example is only
ever included when a `rvs create topology` invocation intentionally names or
discovers it, matching the "opt-in inclusion" behavior described in the
Milestone 2 Slice 2 closure spec.
