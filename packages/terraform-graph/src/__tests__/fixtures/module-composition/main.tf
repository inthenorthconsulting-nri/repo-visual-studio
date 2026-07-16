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
  region = var.region
}

module "network" {
  source     = "./modules/network"
  cidr_block = var.cidr_block
}

resource "aws_instance" "app" {
  ami           = "ami-12345"
  instance_type = "t3.micro"
  subnet_id     = module.network.subnet_id
  depends_on    = [module.network]
}

output "instance_id" {
  value = aws_instance.app.id
}
