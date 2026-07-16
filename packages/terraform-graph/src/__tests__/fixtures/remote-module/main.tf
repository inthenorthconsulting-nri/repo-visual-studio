module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.0"
  name    = "example"
}

module "missing_local" {
  source = "./modules/does-not-exist"
}

resource "aws_instance" "app" {
  ami           = "ami-12345"
  instance_type = "t3.micro"
}
