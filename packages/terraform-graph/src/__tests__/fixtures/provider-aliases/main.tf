terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  alias  = "primary"
  region = "us-east-1"
}

provider "aws" {
  alias  = "secondary"
  region = "us-west-2"
}

resource "aws_s3_bucket" "primary_assets" {
  provider = aws.primary
  bucket   = "provider-aliases-primary"
}

resource "aws_s3_bucket" "secondary_assets" {
  provider = aws.secondary
  bucket   = "provider-aliases-secondary"
}
