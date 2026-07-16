variable "vpc_id" {
  type = string
}

resource "aws_subnet" "app" {
  vpc_id     = var.vpc_id
  cidr_block = "10.0.1.0/24"
}
