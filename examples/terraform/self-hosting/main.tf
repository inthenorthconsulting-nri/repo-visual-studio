terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name for this example"
  default     = "demo"
}

variable "admin_password" {
  type        = string
  description = "Synthetic sensitive credential used only to demonstrate redaction. Not a real secret."
  sensitive   = true
  default     = "example-not-a-real-secret"
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name        = "rvs-self-hosting-example"
    Environment = var.environment
  }
}

resource "aws_subnet" "primary" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
}

resource "aws_subnet" "secondary" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = data.aws_availability_zones.available.names[1]
}

resource "aws_security_group" "app" {
  name        = "rvs-self-hosting-app"
  description = "Synthetic example security group. Not deployable as-is."
  vpc_id      = aws_vpc.main.id
}

resource "aws_instance" "app" {
  ami                    = "ami-0000000000000000"
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.primary.id
  vpc_security_group_ids = [aws_security_group.app.id]
  depends_on              = [aws_subnet.secondary]
}

# The only intentionally dynamic expression in this example: whether the
# bucket is created at all depends on a variable comparison the topology
# builder cannot evaluate without running Terraform, so `count` here is
# preserved as an unresolved expression rather than guessed at "1" or "0".
resource "aws_s3_bucket" "artifacts" {
  count  = var.environment == "demo" ? 1 : 0
  bucket = "rvs-self-hosting-artifacts-${var.environment}"
}

resource "aws_ssm_parameter" "admin_password" {
  name  = "/rvs-self-hosting/${var.environment}/admin-password"
  type  = "SecureString"
  value = var.admin_password
}

# Local child module — fully resolved from checked-in files below.
module "logging" {
  source      = "./modules/logging"
  vpc_id      = aws_vpc.main.id
  environment = var.environment
}

# Remote (registry) module — intentionally represented as an opaque node.
# Never downloaded or evaluated; see the README in this directory.
module "shared_network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"
}

output "vpc_id" {
  description = "ID of the example VPC"
  value       = aws_vpc.main.id
}
